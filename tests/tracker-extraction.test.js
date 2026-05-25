"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractTrackersFromText } = require("../src/recon/tracker-extraction");

test("extractTrackersFromText finds common analytics and pixel identifiers", () => {
  const findings = extractTrackersFromText(`
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script>
    <script>gtag('config', 'UA-12345678-1');</script>
    <script>fbq('init', '123456789012345');</script>
    <script>analytics.load("abcdefghijklmnopqrstuvwxyz");</script>
  `);

  assert.deepEqual(findings.map((item) => `${item.vendor}:${item.id}`).sort(), [
    "Google Analytics 4:G-ABC123DEF4",
    "Google Analytics:UA-12345678-1",
    "Meta Pixel:123456789012345",
    "Segment:abcdefghijklmnopqrstuvwxyz"
  ]);
});
