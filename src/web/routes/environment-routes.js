"use strict";

const { checkLinuxEnvironment, installLinuxTools } = require("../../recon/environment-setup");
const { readBody, sendJson } = require("../http-utils");
const { ensureDefaultWordlists } = require("../services/wordlist-files");

async function checkEnvironment({ response, url }) {
  const environment = await checkLinuxEnvironment({ runtime: url.searchParams.get("runtime") || "linux" });
  sendJson(response, { environment });
}

async function installEnvironment({ request, response, store }) {
  const body = await readBody(request);
  const environment = await installLinuxTools({
    runtime: body.runtime || "linux",
    toolIds: Array.isArray(body.toolIds) ? body.toolIds.map(String) : null
  });
  sendJson(response, { environment, wordlists: ensureDefaultWordlists(store) });
}

module.exports = [
  { method: "GET", path: "/api/environment/check", handler: checkEnvironment },
  { method: "POST", path: "/api/environment/install", handler: installEnvironment }
];
