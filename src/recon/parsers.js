"use strict";

const DEFAULT_EXCLUDED_URL_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "gif",
  "css",
  "tif",
  "tiff",
  "png",
  "ttf",
  "woff",
  "woff2",
  "ico",
  "pdf",
  "svg",
  "txt"
]);

function parseGauUrls(stdout, rootDomains = [], options = {}) {
  const roots = rootDomains.map((d) => String(d).toLowerCase());
  const excludedExtensions = options.excludedExtensions || DEFAULT_EXCLUDED_URL_EXTENSIONS;
  const urls = new Map();
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (roots.length > 0 && !roots.some((root) => host === root || host.endsWith(`.${root}`))) {
      continue;
    }
    if (hasExcludedUrlExtension(parsed.pathname, excludedExtensions)) continue;
    const key = `${parsed.protocol}//${host}${parsed.pathname}${parsed.search}`;
    const params = [...parsed.searchParams.keys()].sort();
    urls.set(key, {
      url: key,
      host,
      path: parsed.pathname || "/",
      query: parsed.search ? parsed.search.slice(1) : "",
      params
    });
  }
  return [...urls.values()].sort((a, b) => a.url.localeCompare(b.url));
}

function hasExcludedUrlExtension(pathname, excludedExtensions = DEFAULT_EXCLUDED_URL_EXTENSIONS) {
  const pathOnly = String(pathname || "").toLowerCase();
  const filename = pathOnly.split("/").pop() || "";
  const match = filename.match(/\.([a-z0-9]+)$/i);
  return Boolean(match && excludedExtensions.has(match[1].toLowerCase()));
}

function parseHttpxJsonLines(stdout) {
  const services = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    let item;
    try {
      item = JSON.parse(raw);
    } catch {
      continue;
    }
    const url = item.url || item.input || item.host;
    if (!url) continue;
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    services.push({
      url,
      host: item.host || parsed?.hostname || null,
      scheme: parsed?.protocol ? parsed.protocol.replace(":", "") : null,
      port: Number(item.port || parsed?.port || (parsed?.protocol === "https:" ? 443 : 80)),
      statusCode: item.status_code ?? item.statusCode ?? null,
      title: item.title || null,
      webserver: item.webserver || item.server || null,
      technologies: Array.isArray(item.tech) ? item.tech : Array.isArray(item.technologies) ? item.technologies : [],
      finalUrl: item.final_url || item.location || null,
      contentLength: item.content_length ?? item.contentLength ?? null,
      raw: item
    });
  }
  return services;
}

module.exports = {
  DEFAULT_EXCLUDED_URL_EXTENSIONS,
  hasExcludedUrlExtension,
  parseGauUrls,
  parseHttpxJsonLines
};
