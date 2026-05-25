"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractIconHrefs } = require("../src/recon/web-fingerprints");

test("extractIconHrefs finds favicon and touch icon links", () => {
  const hrefs = extractIconHrefs(`
    <link rel="stylesheet" href="/app.css">
    <link rel="shortcut icon" href="/favicon.ico">
    <link href="/touch.png" rel="apple-touch-icon">
  `);

  assert.deepEqual(hrefs, ["/favicon.ico", "/touch.png"]);
});
