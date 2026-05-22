"use strict";

const https = require("node:https");
const { extractDomains } = require("./domain-utils");

function fetchText(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { "User-Agent": "AURA recon/0.1" },
      timeout: timeoutMs
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} from ${url}`));
          return;
        }
        resolve(body);
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    request.on("error", reject);
  });
}

async function fetchCrtSh(rootDomain) {
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(rootDomain)}&output=json`;
  const body = await fetchText(url);
  let rows = [];
  try {
    rows = JSON.parse(body);
  } catch {
    rows = [];
  }
  const names = rows.flatMap((row) => String(row.name_value || "").split(/\s+/));
  return extractDomains(names.join("\n"), [rootDomain]);
}

async function fetchWayback(rootDomain) {
  const url = `https://web.archive.org/cdx?url=*.${encodeURIComponent(rootDomain)}/*&output=text&fl=original&collapse=urlkey`;
  const body = await fetchText(url, 30000);
  return extractDomains(body, [rootDomain]);
}

async function runPassiveSource(source, rootDomain) {
  if (source === "crtsh") return fetchCrtSh(rootDomain);
  if (source === "wayback") return fetchWayback(rootDomain);
  throw new Error(`Unknown passive source: ${source}`);
}

module.exports = {
  fetchCrtSh,
  fetchWayback,
  runPassiveSource
};
