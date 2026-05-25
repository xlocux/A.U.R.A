"use strict";

const { commandDisplay, runLinuxTool } = require("./linux-tools");
const ProxyService = require("./proxy-service");

class LinuxToolRunner {
  constructor({ runtime = "linux" } = {}) {
    this.runtime = runtime;
    this.proxyService = new ProxyService();
  }

  /**
   * Run a tool with optional proxy support
   * @param {Object} options - Tool execution options
   * @param {Object} options.tool - Tool definition
   * @param {Array} options.args - Tool arguments
   * @param {Object} options.proxy - Proxy configuration (optional)
   * @param {Object} options.input - Input data (optional)
   * @param {number} options.timeoutMs - Timeout in milliseconds
   * @param {boolean} options.useProxy - Whether to use proxy (default: false)
   * @returns {Promise<Object>} Tool execution result
   */
  async run({ tool, args = [], proxy = null, input = null, timeoutMs = 180000, useProxy = false }) {
    let finalArgs = [...args];
    const proxyUrl = useProxy && proxy ? this.proxyService.formatProxyUrl(proxy) : null;

    if (proxyUrl) {
      finalArgs = this._addProxyArgsToTool(tool.binary, finalArgs, proxy);
    }

    const result = await runLinuxTool({
      runtime: this.runtime,
      toolName: tool.binary,
      args: finalArgs,
      input,
      timeoutMs,
      proxyUrl
    });
    
    return {
      ...result,
      commandDisplay: commandDisplay(this.runtime, tool.binary, finalArgs),
      proxyUsed: proxy ? {
        address: proxy.address,
        port: proxy.port,
        type: proxy.type
      } : null
    };
  }

  /**
   * Add proxy-specific arguments to tools that support native proxy flags
   * @private
   */
  _addProxyArgsToTool(toolName, args, proxy) {
    // Tools that support native proxy arguments
    const proxyTools = {
      // Tools that use -x or --proxy for HTTP proxy
      'curl': ['-x', `${proxy.type}://${proxy.address}:${proxy.port}`],
      'wget': ['-e', `use_proxy=yes`, '-e', `http_proxy=${proxy.type}://${proxy.address}:${proxy.port}`],
      
      // Tools that use --proxy for SOCKS
      'nmap': ['--proxy', `${proxy.type}://${proxy.address}:${proxy.port}`],
      
      // Tools that use specific proxy arguments
      'masscan': ['--proxy', `${proxy.address}:${proxy.port}`],
      'ffuf': ['-x', `${proxy.type}://${proxy.address}:${proxy.port}`],
      'gobuster': ['-p', `${proxy.address}:${proxy.port}`],
      'dirsearch': ['--proxy', `${proxy.type}://${proxy.address}:${proxy.port}`],
      'aquatone': ['-http-proxy', `${proxy.address}:${proxy.port}`]
    };

    // If tool supports native proxy args, add them
    if (proxyTools[toolName]) {
      return [...args, ...proxyTools[toolName]];
    }

    // For tools that don't support native proxy args, rely on environment variables
    return args;
  }

  /**
   * Close service connections
   */
  async close() {
    await this.proxyService.close();
  }
}

module.exports = {
  LinuxToolRunner
};
