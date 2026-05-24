"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_EXCLUDED_URL_EXTENSIONS, hasExcludedUrlExtension, parseGauUrls } = require("../src/recon/parsers");

test("default URL mining filter excludes static asset extensions", () => {
  for (const extension of ["jpg", "jpeg", "gif", "css", "tif", "tiff", "png", "ttf", "woff", "woff2", "ico", "pdf", "svg", "txt"]) {
    assert.ok(DEFAULT_EXCLUDED_URL_EXTENSIONS.has(extension), `${extension} should be excluded by default`);
    assert.equal(hasExcludedUrlExtension(`/assets/file.${extension}`), true);
  }
});

test("parseGauUrls keeps dynamic URLs and drops static assets", () => {
  const urls = parseGauUrls(`
https://app.example.com/login?next=/admin
https://app.example.com/static/app.js
https://app.example.com/static/app.css
https://app.example.com/logo.png
https://cdn.example.net/out-of-scope?x=1
https://app.example.com/download?file=report.pdf
`, ["example.com"]);

  assert.deepEqual(urls.map((item) => item.url), [
    "https://app.example.com/download?file=report.pdf",
    "https://app.example.com/login?next=/admin",
    "https://app.example.com/static/app.js"
  ]);
  assert.deepEqual(urls.find((item) => item.path === "/login")?.params, ["next"]);
});
