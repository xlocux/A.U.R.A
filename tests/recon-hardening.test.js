"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { extractDomains } = require("../src/recon/domain-utils");
const { extractScriptUrls, isAllowedScriptHost, prepareRetireInput } = require("../src/recon/technology-detectors");
const { extractTrackersFromText, extractTrackersFromServices } = require("../src/recon/tracker-extraction");
const { extractIconHrefs, extractFaviconsFromServices } = require("../src/recon/web-fingerprints");
const { fetchText } = require("../src/recon/passive-sources");
const { domainBrandTokens, suggestReverseWhoisTermsFromRdapRecords, isTargetRelatedTerm } = require("../src/recon/providers/rdap-suggestions");
const { isReverseWhoisSource, scoreCandidate } = require("../src/recon/candidate-correlation");

function timed(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function endlessHandler(_req, res) {
  res.writeHead(200, { "content-type": "text/html" });
  const chunk = Buffer.alloc(64 * 1024, "a");
  const timer = setInterval(() => res.write(chunk), 1);
  res.on("close", () => clearInterval(timer));
}

test("regexes scanning target pages stay fast on crafted input and still match normal tags", () => {
  const scripts = timed(() => extractScriptUrls("<script src='x' ".repeat(2048), "https://a.test/"));
  assert.ok(scripts.ms < 200, `script scan took ${scripts.ms}ms`);
  assert.deepEqual(extractScriptUrls('<script defer src="/app.js"></script>', "https://a.test/"), ["https://a.test/app.js"]);

  const fbq = timed(() => extractTrackersFromText("fbq(init ".repeat(2048)));
  assert.ok(fbq.ms < 200, `fbq scan took ${fbq.ms}ms`);
  assert.equal(extractTrackersFromText("fbq('init', '123456789012345');")[0].id, "123456789012345");

  const links = timed(() => extractIconHrefs("<link ".repeat(8000)));
  assert.ok(links.ms < 200, `link scan took ${links.ms}ms`);
  assert.deepEqual(extractIconHrefs('<link rel="icon" href="/f.ico">'), ["/f.ico"]);
});

test("extractDomains does not glue escapes onto labels and stays linear", () => {
  assert.deepEqual(extractDomains("?next=https%3A%2F%2Fapp.example.com", ["example.com"]), ["app.example.com"]);
  assert.deepEqual(extractDomains("%252F%252Fcdn.example.com", ["example.com"]), ["cdn.example.com"]);
  assert.deepEqual(extractDomains(JSON.stringify("x\nns1.example.com\tcdn.example.com"), ["example.com"]), ["cdn.example.com", "ns1.example.com"]);
  assert.deepEqual(extractDomains("see www.example.com, mail.example.co.uk", []), ["mail.example.co.uk", "www.example.com"]);
  const slow = timed(() => extractDomains("a.".repeat(20000)));
  assert.ok(slow.ms < 200, `extractDomains took ${slow.ms}ms`);
});

test("passive fetchText aborts an endless stream at the byte cap and at the deadline", async () => {
  const { server, port } = await listen(endlessHandler);
  try {
    await assert.rejects(
      fetchText(`http://127.0.0.1:${port}/`, 20000, 0, { transport: http, maxBytes: 1024 * 1024 }),
      /larger than/
    );
    await assert.rejects(
      fetchText(`http://127.0.0.1:${port}/`, 20000, 0, { transport: http, maxBytes: 1e12, deadlineMs: 300 }),
      /deadline/
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("reverse whois leads are recognised under their real source name", () => {
  assert.ok(isReverseWhoisSource("whoisxmlapi-reverse-whois"));
  assert.ok(isReverseWhoisSource("whoisxmlapi"));
  assert.ok(!isReverseWhoisSource("rdap-associated-domain"));
  const scored = scoreCandidate({ lead: { value: "candidate.test", source: "whoisxmlapi-reverse-whois" }, rootDomains: ["example.com"] });
  assert.ok(JSON.stringify(scored).includes("Reverse WHOIS provider"));
});

test("brand tokens use the registrable label for second-level country domains", () => {
  assert.deepEqual([...domainBrandTokens(["acme.co.uk"])], ["acme"]);
  assert.deepEqual([...domainBrandTokens(["acme.com.br"])], ["acme"]);
  const tokens = domainBrandTokens(["acme.com.br"]);
  assert.equal(isTargetRelatedTerm("Acme Holdings Ltda", tokens), true);
  assert.equal(isTargetRelatedTerm("gmail.com", tokens), false);
  assert.equal(isTargetRelatedTerm("Registro Comercial Ltda", tokens), false);
  const rdap = suggestReverseWhoisTermsFromRdapRecords([{ domain: "acme.co.uk", raw: { entities: [{ vcardArray: ["vcard", [["org", {}, "text", "Acme Holdings Ltd"]]], roles: ["registrant"] }] } }], ["acme.co.uk"]);
  assert.ok(rdap.includeTerms.some((term) => /acme/i.test(term)), JSON.stringify(rdap.includeTerms));
});

test("page, icon and tracker fetches are byte-capped", async () => {
  const { server, port } = await listen(endlessHandler);
  const url = `http://127.0.0.1:${port}/`;
  try {
    const trackers = await extractTrackersFromServices({ services: [{ url, host: "127.0.0.1" }], timeoutMs: 400 });
    assert.equal(trackers[0].vendor, "tracker-fetch");
    const icons = await extractFaviconsFromServices({ services: [{ url }], timeoutMs: 400 });
    assert.deepEqual(icons, []);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("retire input skips off-host script URLs and caps downloads", async () => {
  const hits = [];
  const { server, port } = await listen((req, res) => {
    hits.push(req.url);
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end('<script src="/own.js"></script><script src="http://127.0.0.1:1/lan.js"></script><script src="http://192.168.1.1/x.js"></script>');
    } else if (req.url === "/own.js") {
      res.end("var a=1;");
    } else res.end("x");
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-retire-"));
  try {
    const service = { url: `http://127.0.0.1:${port}/`, host: `127.0.0.1:${port}` };
    const input = await prepareRetireInput({ service, artifactsDir: dir });
    assert.equal(input.scriptCount, 1);
    assert.deepEqual(hits.sort(), ["/", "/own.js"]);
    assert.equal(isAllowedScriptHost("http://192.168.1.1/x.js", service, ["example.com"]), false);
    assert.equal(isAllowedScriptHost("https://cdn.example.com/x.js", service, ["example.com"]), true);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
