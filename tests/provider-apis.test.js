"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { INTELX_BASE_URL, PROVIDERS, providerCatalog, validateProviderKey } = require("../src/recon/provider-apis");

test("provider catalog includes requested recon APIs and auth formats", () => {
  const byId = Object.fromEntries(providerCatalog().map((provider) => [provider.id, provider]));
  for (const id of ["censys", "hunterio", "binaryedge", "certspotter", "passivetotal", "securitytrails", "shodan", "urlscan", "virustotal", "zoomeye", "spyse", "intelx"]) {
    assert.ok(byId[id], `${id} should be registered`);
    assert.ok(byId[id].docs, `${id} should expose docs`);
  }
  assert.equal(byId.censys.secretFormat, "api_id:api_secret");
  assert.equal(byId.passivetotal.secretFormat, "username:api_secret");
});

test("provider preflight validates compound auth format before network calls", async () => {
  const censys = await validateProviderKey("censys", "only-id");
  const passivetotal = await validateProviderKey("passivetotal", "only-user");
  assert.equal(censys.ok, false);
  assert.match(censys.message, /api_id:api_secret/);
  assert.equal(passivetotal.ok, false);
  assert.match(passivetotal.message, /username:api_secret/);
});

test("intelx provider uses the free endpoint base url", () => {
  assert.equal(INTELX_BASE_URL, "https://free.intelx.io");
  assert.equal(PROVIDERS.intelx.preflight.url, "https://free.intelx.io/authenticate/info");
  assert.equal(providerCatalog().find((provider) => provider.id === "intelx").docs, "https://free.intelx.io/");
});
