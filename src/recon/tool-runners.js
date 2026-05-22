"use strict";

const { commandDisplay, runWslTool } = require("./wsl-tools");

class WslToolRunner {
  constructor({ distro = "kali-linux" } = {}) {
    this.distro = distro;
  }

  async run({ tool, args = [], input = null, timeoutMs = 180000 }) {
    const result = await runWslTool({
      distro: this.distro,
      toolName: tool.binary,
      args,
      input,
      timeoutMs
    });
    return {
      ...result,
      commandDisplay: commandDisplay(this.distro, tool.binary, args)
    };
  }
}

module.exports = {
  WslToolRunner
};
