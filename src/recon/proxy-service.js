// Proxy Service - Core business logic for proxy management
// Handles preflight testing, rotation strategy, block detection, and tool integration

const ProxyStore = require('../db/proxy-store');
const axios = require('axios');
const { URL } = require('url');
const net = require('net');
const dns = require('dns');
const crypto = require('crypto');

class ProxyService {
  constructor() {
    this.store = new ProxyStore();
    this.preflightTargets = [
      { name: 'ipify', url: 'https://api.ipify.org?format=json', timeout: 5000 },
      { name: 'google', url: 'https://www.google.com/generate_204', timeout: 5000, followRedirect: false },
      { name: 'cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace/', timeout: 5000 }
    ];
  }

  /**
   * Preflight test a single proxy
   * @param {Object} proxy - Proxy object with address, port, type
   * @param {Object} options - Testing options
   * @returns {Promise<Object>} Test results
   */
  async preflightProxy(proxy, options = {}) {
    const {
      timeout = 5000,
      maxRetries = 1,
      testTargets = this.preflightTargets
    } = options;

    const proxyUrl = `${proxy.type}://${proxy.address}:${proxy.port}`;
    const startTime = Date.now();
    
    let results = {
      proxyId: null,
      success: false,
      latency: null,
      ipAddress: null,
      country: null,
      typeVerified: false,
      reachability: {},
      errors: [],
      timestamp: new Date().toISOString()
    };

    // Test each target
    for (const target of testTargets) {
      try {
        const targetStart = Date.now();
        const response = await axios.get(target.url, {
          proxy: {
            host: proxy.address,
            port: proxy.port,
            auth: proxy.username && proxy.password ? {
              username: proxy.username,
              password: proxy.password
            } : false
          },
          timeout: target.timeout || timeout,
          maxRedirects: target.followRedirect ? 5 : 0,
          validateStatus: target.validateStatus || (status => status < 400)
        });

        const targetLatency = Date.now() - targetStart;
        results.reachability[target.name] = {
          success: true,
          latency: targetLatency,
          status: response.status,
          data: target.name === 'ipify' ? response.data : null
        };

        // Extract IP from ipify response
        if (target.name === 'ipify' && response.data && response.data.ip) {
          results.ipAddress = response.data.ip;
        }

      } catch (error) {
        results.reachability[target.name] = {
          success: false,
          latency: Date.now() - targetStart,
          error: error.message,
          code: error.code
        };
        results.errors.push(`${target.name}: ${error.message}`);
      }
    }

    // Calculate overall success (at least one target succeeded)
    results.success = Object.values(results.reachability).some(r => r.success);
    
    // Calculate average latency for successful tests
    const successfulTests = Object.values(results.reachability).filter(r => r.success);
    if (successfulTests.length > 0) {
      results.latency = Math.floor(
        successfulTests.reduce((sum, r) => sum + r.latency, 0) / successfulTests.length
      );
    }

    // Verify proxy type by checking if we got a response through the proxy
    results.typeVerified = results.success;

    results.latency = Date.now() - startTime;

    return results;
  }

  /**
   * Batch test multiple proxies with concurrency limit
   * @param {Array} proxies - Array of proxy objects
   * @param {Object} options - Testing options
   * @returns {Promise<Array>} Array of test results
   */
  async batchPreflight(proxies, options = {}) {
    const {
      concurrency = 10,
      runId = `preflight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    } = options;

    const results = [];
    const semaphore = new Semaphore(concurrency);

    const testProxyWithSemaphore = async (proxy) => {
      await semaphore.acquire();
      try {
        const result = await this.preflightProxy(proxy, options);
        result.proxyId = proxy.id || await this._getOrCreateProxyId(proxy);
        
        // Store results in database
        await this._storeProxyMetrics(result.proxyId, result);
        await this.store.recordTestRun(
          runId,
          result.proxyId,
          options.targetUrl || 'preflight',
          result.success,
          result.latency,
          result.errors.length > 0 ? result.errors.join('; ') : null,
          null
        );

        results.push(result);
        return result;
      } finally {
        semaphore.release();
      }
    };

    // Execute all tests
    const promises = proxies.map(proxy => testProxyWithSemaphore(proxy));
    await Promise.all(promises);

    // Sort by success rate and latency
    results.sort((a, b) => {
      if (a.success !== b.success) return b.success - a.success; // Success first
      if (a.latency !== b.latency) return a.latency - b.latency; // Lower latency first
      return 0;
    });

    return results;
  }

  /**
   * Detect if a response indicates blocking
   * @param {Object} response - HTTP response object
   * @param {string} body - Response body
   * @returns {Object} Block detection result
   */
  detectBlockage(response, body = '') {
    const statusCode = response.status || response.statusCode;
    const headers = response.headers || {};
    
    // Status code based detection
    const statusBlocks = [403, 429, 503, 502, 504];
    const isStatusBlock = statusBlocks.includes(statusCode);
    
    // Content based detection
    const blockIndicators = [
      /access denied/i,
      /blocked/i,
      /rate limit/i,
      /too many requests/i,
      /please solve/i,
      /captcha/i,
      /cloudflare/i,
      /ddos protection/i,
      /security check/i,
      /verify you are human/i
    ];
    
    const contentBlock = blockIndicators.some(pattern => pattern.test(body));
    
    // Connection based detection would be handled at the request level
    
    let severity = 'low';
    if (isStatusBlock || contentBlock) {
      if ([429, 503].includes(statusCode) || /rate limit/i.test(body)) {
        severity = 'medium';
      }
      if ([403].includes(statusCode) || /access denied/i.test(body)) {
        severity = 'high';
      }
    }

    return {
      isBlocked: isStatusBlock || contentBlock,
      severity: severity,
      reason: isStatusBlock ? `HTTP ${statusCode}` : 
              contentBlock ? 'Content indicates blocking' : 
              'No blocking detected',
      statusCode,
      blockedBy: isStatusBlock ? 'status_code' : 
                contentBlock ? 'content' : 'none'
    };
  }

  /**
   * Get next proxy for rotation based on strategy
   * @param {Object} lastFailedProxy - The proxy that failed (if any)
   * @param {Object} context - Context including toolId, target, etc.
   * @returns {Promise<Object|null>} Next proxy to use
   */
  async getNextProxy(lastFailedProxy = null, context = {}) {
    const {
      toolId = null,
      target = null,
      avoidFailed = true,
      strategy = 'smart' // smart, round-robin, random, performance
    } = context;

    // Get active proxies
    let proxies = await this.store.getActiveProxies();
    
    if (proxies.length === 0) {
      // If no active proxies, try unknown status
      proxies = await this.store.getBestProxies(50, { minSuccessRate: 0 });
    }

    if (proxies.length === 0) {
      return null;
    }

    // Filter out recently failed proxy if requested
    if (avoidFailed && lastFailedProxy) {
      proxies = proxies.filter(p => 
        !(p.address === lastFailedProxy.address && 
          p.port === lastFailedProxy.port && 
          p.type === lastFailedProxy.type)
      );
      
      // If all proxies were filtered out, reset and try again
      if (proxies.length === 0) {
        proxies = await this.store.getActiveProxies();
      }
    }

    // Apply tool-specific filtering if toolId provided
    if (toolId) {
      // In a real implementation, we might have tool-proxy affinity or restrictions
      // For now, we'll just use all proxies
    }

    // Apply rotation strategy
    switch (strategy) {
      case 'round-robin':
        return this._getRoundRobinProxy(proxies, context);
      case 'random':
        return this._getRandomProxy(proxies);
      case 'performance':
        return this._getBestPerformanceProxy(proxies, { toolId });
      case 'smart':
      default:
        return this._getSmartProxy(proxies, lastFailedProxy, context);
    }
  }

  /**
   * Smart proxy selection based on multiple factors
   * @private
   */
  async _getSmartProxy(proxies, lastFailedProxy, context) {
    // Weight proxies by success rate and latency
    const weightedProxies = proxies.map(proxy => {
      // Base weight from success rate (0-1)
      const successWeight = proxy.success_rate || 0.5;
      
      // Latency weight (inverse - lower latency is better)
      const maxLatency = 10000; // 10 seconds max
      const latencyWeight = Math.max(0, 1 - (proxy.latency_ms || maxLatency) / maxLatency);
      
      // Recent failure penalty
      const failurePenalty = Math.min(0.9, (proxy.failures_count || 0) * 0.1);
      
      // Combined weight
      return {
        ...proxy,
        weight: (successWeight * 0.5 + latencyWeight * 0.3) * (1 - failurePenalty)
      };
    });

    // Sort by weight descending
    weightedProxies.sort((a, b) => b.weight - a.weight);
    
    // Return the best proxy
    return weightedProxies[0] || null;
  }

  /**
   * Get proxy using round-robin strategy
   * @private
   */
  _getRoundRobinProxy(proxies, context) {
    // In a real implementation, we'd track the last used index per context
    // For simplicity, we'll just return a proxy based on timestamp
    const index = Math.floor(Date.now() / 1000) % proxies.length;
    return proxies[index];
  }

  /**
   * Get proxy using random strategy
   * @private
   */
  _getRandomProxy(proxies) {
    const index = Math.floor(Math.random() * proxies.length);
    return proxies[index];
  }

  /**
   * Get proxy with best performance metrics
   * @private
   */
  async _getBestPerformanceProxy(proxies, filters = {}) {
    const bestProxies = await this.store.getBestProxies(1, filters);
    return bestProxies[0] || null;
  }

  /**
   * Get or create proxy ID in database
   * @private
   */
  async _getOrCreateProxyId(proxy) {
    // Try to find existing proxy
    const existing = await this._findProxy(proxy);
    if (existing) {
      return existing.id;
    }
    
    // Create new proxy
    return await this.store.addProxy(
      proxy.address,
      proxy.port,
      proxy.type,
      {
        country: proxy.country,
        username: proxy.username,
        password: proxy.password,
        status: 'unknown'
      }
    );
  }

  /**
   * Find proxy by address, port, type
   * @private
   */
  async _findProxy(proxy) {
    return new Promise((resolve, reject) => {
      this.store.db.get(
        `SELECT * FROM proxies WHERE address = ? AND port = ? AND type = ?`,
        [proxy.address, proxy.port, proxy.type],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
  }

  /**
   * Store proxy metrics in database
   * @private
   */
  async _storeProxyMetrics(proxyId, metrics) {
    await this.store.updateProxyStatus(
      proxyId,
      metrics.success ? 'active' : 'failed',
      {
        latency_ms: metrics.latency,
        success_rate: metrics.success ? 1.0 : 0.0,
        failures_count: metrics.success ? 0 : 1,
        total_tests: 1,
        successful_tests: metrics.success ? 1 : 0,
        avg_response_time: metrics.latency
      }
    );
  }

  /**
   * Configure HTTP agent for proxy usage
   * @param {Object} proxy - Proxy configuration
   * @returns {Object} HTTP agent options
   */
  getProxyAgentOptions(proxy) {
    if (!proxy) return {};

    const proxyAuth = proxy.username && proxy.password ?
      `${proxy.username}:${proxy.password}@` : '';

    const proxyUrl = `${proxy.type}://${proxyAuth}${proxy.address}:${proxy.port}`;

    return {
      proxy: {
        host: proxy.address,
        port: proxy.port,
        auth: proxy.username && proxy.password ?
          { username: proxy.username, password: proxy.password } : false
      }
    };
  }

  /**
   * Get proxy environment variables for tool execution
   * @param {Object} proxy - Proxy configuration
   * @returns {Object} Environment variables
   */
  getProxyEnvVars(proxy) {
    if (!proxy) return {};

    const proxyAuth = proxy.username && proxy.password ?
      `${proxy.username}:${proxy.password}@` : '';

    const proxyUrl = `${proxy.type}://${proxyAuth}${proxy.address}:${proxy.port}`;

    return {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl
    };
  }

  /**
   * Close database connection
   */
  async close() {
    await this.store.close();
  }
}

// Simple semaphore implementation for concurrency control
class Semaphore {
  constructor(maxCount) {
    this.maxCount = maxCount;
    this.currentCount = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.currentCount < this.maxCount) {
      this.currentCount++;
      return;
    }
    
    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release() {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      resolve();
    } else {
      this.currentCount--;
    }
  }
}

module.exports = ProxyService;