"use strict";

const fs = require("node:fs");
const { normalizeProxyUrl } = require("../../recon/linux-tools");
const { HttpError, readBody, sendJson } = require("../http-utils");
const { discoverTargets, inferRootDomains } = require("../target-service");
const { startTargetBootstrap } = require("../services/target-bootstrap");
const {
  buildTargetConfigFromRequest,
  readTargetConfig,
  removeTargetFiles,
  saveTargetConfig,
  targetConfigPath,
  validateOrThrow
} = require("../services/target-configs");

const DEFAULT_TIMEOUT_MS = 180000;

function parseProxyOrThrow(value) {
  try {
    return normalizeProxyUrl(value);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

function listTargets({ response, store }) {
  const targets = discoverTargets(store).map((target) => ({ ...target, root_domains: inferRootDomains(target) }));
  sendJson(response, { targets });
}

async function createTarget({ request, response, store }) {
  const body = await readBody(request);
  const proxyUrl = parseProxyOrThrow(body.proxyUrl);
  const built = buildTargetConfigFromRequest(body);
  if (built.error) throw new HttpError(400, built.error);
  if (fs.existsSync(targetConfigPath(built.config.target_name))) {
    throw new HttpError(409, `Target already exists: ${built.config.target_name}`);
  }
  validateOrThrow(built.config);
  const { configPath, target } = saveTargetConfig(store, built.config);
  // bootstrap:false lets a caller that starts its own recon (quick start) avoid a duplicate parallel run.
  const bootstrapRun = body.bootstrap === false ? null : startTargetBootstrap({
    store,
    target,
    config: built.config,
    authorized: true,
    linuxRuntime: body.linuxRuntime || body.runtime || "linux",
    timeoutMs: Number(body.timeoutMs) || DEFAULT_TIMEOUT_MS,
    proxyUrl
  });
  sendJson(response, { target, config: built.config, configPath, bootstrapRun }, 201);
}

function getTargetConfig({ response, store, params }) {
  const { configPath, config } = readTargetConfig(params.name);
  store.upsertTarget(configPath, config);
  sendJson(response, { config, configPath });
}

async function updateTargetConfig({ request, response, store, params }) {
  const body = await readBody(request);
  const config = body.config;
  validateOrThrow(config);
  if (config.target_name !== params.name) throw new HttpError(400, "target_name cannot be changed from this editor");
  readTargetConfig(params.name);
  const { configPath, target } = saveTargetConfig(store, config);
  sendJson(response, { target, config, configPath });
}

function deleteTarget({ response, store, params }) {
  const targetName = params.name;
  const target = store.getTarget(targetName);
  if (!target) throw new HttpError(404, `Target not found: ${targetName}`);
  if (store.listRuns({ limit: 1000, targetName }).some((run) => ["queued", "running", "paused"].includes(run.status))) {
    throw new HttpError(409, `Target ${targetName} has an active run. Stop it before deleting the target.`);
  }
  const removed = store.deleteTarget(targetName);
  removeTargetFiles(targetName, target.config_path, removed.runIds);
  sendJson(response, { deleted: true, targetName, runIds: removed.runIds });
}

function listTargetLeads({ response, store, params }) {
  sendJson(response, { leads: store.listAssetLeads({ targetName: params.name }) });
}

module.exports = [
  { method: "GET", path: "/api/targets", handler: listTargets },
  { method: "POST", path: "/api/targets", handler: createTarget },
  { method: "GET", path: "/api/targets/:name", handler: getTargetConfig },
  { method: "GET", path: "/api/targets/:name/config", handler: getTargetConfig },
  { method: "PUT", path: "/api/targets/:name/config", handler: updateTargetConfig },
  { method: "DELETE", path: "/api/targets/:name", handler: deleteTarget },
  { method: "GET", path: "/api/targets/:name/asset-leads", handler: listTargetLeads },
  { method: "GET", path: "/api/targets/:name/leads", handler: listTargetLeads }
];
