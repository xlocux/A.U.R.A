"use strict";

const { readLimitedBuffer } = require("./proxy-sources");

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_HTML_SCAN_CHARS = 1000000;
const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; AURA-Recon/0.1)";

// One fetch for every target-page read: byte cap, deadline that also covers the body, optional final-URL check.
async function fetchBounded(url, { fetchImpl = fetch, timeoutMs = 12000, maxBytes = MAX_PAGE_BYTES, accept = "*/*", userAgent = DEFAULT_USER_AGENT, allowFinalUrl = null, label = "Response" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      headers: { "Accept": accept, "User-Agent": userAgent },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // A redirect must not carry us to a host the caller did not allow (LAN, loopback).
    if (allowFinalUrl && response.url && !allowFinalUrl(response.url)) {
      controller.abort();
      throw new Error("redirected outside the allowed hosts");
    }
    const bytes = await readLimitedBuffer(response, maxBytes, label);
    return { bytes, url: response.url || url, contentType: response.headers.get("content-type") || "" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBoundedText(url, options = {}) {
  const result = await fetchBounded(url, options);
  return { ...result, text: result.bytes.toString("utf8") };
}

module.exports = { MAX_HTML_SCAN_CHARS, MAX_ICON_BYTES, MAX_PAGE_BYTES, fetchBounded, fetchBoundedText };
