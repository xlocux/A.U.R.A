#!/usr/bin/env node
"use strict";

require("../src/recon/recon-engine-runtime-patch").installReconRuntimePatch();

const { startWebServer } = require("../src/web/server");

startWebServer(process.argv).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
