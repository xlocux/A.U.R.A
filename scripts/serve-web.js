#!/usr/bin/env node
"use strict";

const { startWebServer } = require("../src/web/server");

startWebServer(process.argv).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
