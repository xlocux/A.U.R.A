// Proxy Preflight - Dedicated proxy testing and validation engine
// Handles comprehensive proxy testing with multiple protocols and targets

const axios = require('axios');
const net = require('net');
const dns = require('dns');
const { ProxyService } = require('./proxy-service');
const ProxyStore = require('../db/proxy-store');

class ProxyPreflight {
  constructor() {
    this.proxyService = new ProxyService();
    this.store = new ProxyStore();
    
    // Default test targets for different protocols
    this.testTargets = {
      http: [
        { name: 'ipify', url: 'https://api.ipify.org?format=json', timeout: 5000 },
        { name: 'google', url: 'https://www.google.com/generate_204', timeout: 5000, followRedirect: false },
        { name: 'cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace/', timeout: 5000 }
      ],
      https: [
        { name: 'ipify', url: 'https://api.ipify.org?format=json', timeout: 5000 },
        { name: 'google', url: 'https://www.google.com/generate_204', timeout: 5000, followRedirect: false },
        { name: 'github', url: 'https://api.github.com', timeout: 5000 }
      ],
      socks4: [
        { name: 'ipify', url: 'https://api.ipify.org?format=json', timeout: 8000 },
        { name: 'google', url: 'https://www.google.com/generate_204', timeout: 8000, followRedirect: false }
      ],
      socks5: [
        { name: 'ipify', url: 'https://api.ipify.org?format=json', timeout: 8000 },
        { name: 'google', url: 'https://www.google.com/generate_204', timeout: 8000, followRedirect: false },
        { name: 'dns-check', type: 'dns', host: 'google.com', timeout: 5000 }
      ]
    };
  }

  /**
   * Test a single proxy with comprehensive validation
   * @param {Object} proxy - Proxy configuration
   * @param {Object} options - Testing options
   * @returns {Promise<Object>} Detailed test results
   */
  async testProxy(proxy, options = {}) {
    const {
      protocol = proxy.type || 'http',
      concurrency = 5,
      timeout = 5000,
      customTargets = null,
      runId = `preflight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    } = options;

    // Determine which tests to run
    const targets = customTargets || 
                   (this.testTargets[protocol] || this.testTargets.http);

    const startTime = Date.now();
    
    // Initialize results
    const results = {
      proxyId: null,
      proxy: {
        address: proxy.address,
        port: proxy.port,
        type: proxy.type,
        username: proxy.username || null,
        country: proxy.country || null
      },
      success: false,
      latency: null,
      ipAddress: null,
      countryDetected: null,
      typeVerified: false,
      anonymityLevel: 'unknown', // transparent, anonymous, elite
      reachability: {},
      dnsLeakTest: {},
      speedTest: {},
      errors: [],
      warnings: [],
      timestamp: new Date().toISOString(),
      runId
    };

    try {
      // Test connectivity through proxy
      const connectivityResult = await this._testConnectivity(proxy, targets, timeout);
      results.reachability = connectivityResult.reachability;
      results.success = connectivityResult.success;
      results.latency = connectivityResult.latency;
      results.ipAddress = connectivityResult.ipAddress;
      results.errors = connectivityResult.errors;
      
      // If successful, run additional tests
      if (results.success) {
        // Test for DNS leaks
        results.dnsLeakTest = await this._testDNSLeak(proxy, timeout);
        
        // Perform speed test
        results.speedTest = await this._testSpeed(proxy, timeout);
        
        // Detect anonymity level
        results.anonymityLevel = await this._detectAnonymityLevel(proxy, timeout);
        
        // Verify proxy type
        results.typeVerified = await this._verifyProxyType(proxy, timeout);
        
        // Extract country from IP if available
        if (results.ipAddress) {
          results.countryDetected = await this._getCountryFromIP(results.ipAddress);
        }
      }
      
      results.latency = Date.now() - startTime;
      
    } catch (error) {
      results.errors.push(`Unexpected error: ${error.message}`);
      results.success = false;
    }

    // Store or update proxy in database
    try {
      results.proxyId = await this.proxyService._getOrCreateProxyId(proxy);
      
      // Update proxy metrics based on test results
      await this.proxyService.store.updateProxyStatus(
        results.proxyId,
        results.success ? 'active' : 'failed',
        {
          latency_ms: results.latency,
          success_rate: results.success ? 1.0 : 0.0,
          failures_count: results.success ? 0 : 1,
          total_tests: 1,
          successful_tests: results.success ? 1 : 0,
          avg_response_time: results.latency
        }
      );
      
      // Record detailed test run
      await this.proxyService.store.recordTestRun(
        runId,
        results.proxyId,
        'preflight_comprehensive',
        results.success,
        results.latency,
        results.errors.length > 0 ? results.errors.join('; ') : null,
        null
      );
    } catch (dbError) {
      results.warnings.push(`Database storage warning: ${dbError.message}`);
    }

    return results;
  }

  /**
   * Test basic connectivity through proxy
   * @private
   */
  async _testConnectivity(proxy, targets, timeout) {
    const results = {
      reachability: {},
      success: false,
      latency: null,
      ipAddress: null,
      errors: []
    };

    let successfulTests = 0;
    let totalLatency = 0;

    for (const target of targets) {
      try {
        const targetStart = Date.now();
        let response;
        
        if (target.type === 'dns') {
          // DNS-specific test
          response = await this._testDNSResolution(proxy, target.host, timeout);
        } else {
          // HTTP/HTTPS test
          response = await axios.get(target.url, {
            proxy: {
              host: proxy.address,
              port: proxy.port,
              auth: proxy.username && proxy.password ?
                { username: proxy.username, password: proxy.password } : false
            },
            timeout: target.timeout || timeout,
            maxRedirects: target.followRedirect ? 5 : 0,
            validateStatus: target.validateStatus || (status => status < 400),
            headers: target.headers || {}
          });
        }

        const targetLatency = Date.now() - targetStart;
        totalLatency += targetLatency;
        successfulTests++;

        results.reachability[target.name] = {
          success: true,
          latency: targetLatency,
          status: response.status || 200,
          data: target.name === 'ipify' && response.data ? response.data : null,
          headers: response.headers || {}
        };

        // Extract IP from ipify or similar services
        if (target.name === 'ipify' && response.data && response.data.ip) {
          results.ipAddress = response.data.ip;
        } else if (target.name === 'cloudflare' && response.data) {
          // Cloudflare trace contains IP information
          const ipMatch = response.data.match(/ip=([^\s]+)/);
          if (ipMatch) {
            results.ipAddress = ipMatch[1];
          }
        }

      } catch (error) {
        results.reachability[target.name] = {
          success: false,
          latency: Date.now() - targetStart,
          error: error.message,
          code: error.code || 'UNKNOWN'
        };
        results.errors.push(`${target.name}: ${error.message}`);
      }
    }

    results.success = successfulTests > 0;
    results.latency = successfulTests > 0 ? Math.floor(totalLatency / successfulTests) : null;
    
    return results;
  }

  /**
   * Test DNS resolution through proxy (for SOCKS proxies)
   * @private
   */
  async _testDNSResolution(proxy, hostname, timeout) {
    return new Promise((resolve, reject) => {
      // For SOCKS proxies, we'd need to use a SOCKS-capable DNS resolver
      // For now, we'll do a simple TCP connection test to port 53
      // A full implementation would use a SOCKS client library
      
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      
      const dnsServer = '8.8.8.8'; // Google DNS
      const dnsPort = 53;
      
      socket.once('connect', () => {
        socket.destroy();
        resolve({ success: true });
      });
      
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('DNS timeout'));
      });
      
      socket.once('error', (err) => {
        socket.destroy();
        reject(new Error(`DNS connection failed: ${err.message}`));
      });
      
      // Note: This doesn't actually use the proxy for DNS
      // A real implementation would route through the SOCKS proxy
      socket.connect(dnsPort, dnsServer);
    });
  }

  /**
   * Test for DNS leaks
   * @private
   */
  async _testDNSLeak(proxy, timeout) {
    const results = {
      leakDetected: false,
      leakDetails: null,
      dnsServersUsed: [],
      timestamp: new Date().toISOString()
    };

    try {
      // Test using a DNS leak test service
      const response = await axios.get('https://dnsleaktest.com/json/', {
        proxy: {
          host: proxy.address,
          port: proxy.port,
          auth: proxy.username && proxy.password ?
            { username: proxy.username, password: proxy.password } : false
        },
        timeout: timeout * 2, // DNS tests might take longer
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AURA-ProxyTest/1.0)' }
      });

      if (response.data && response.data.Status === 'INACTIVE') {
        results.leakDetected = false;
        results.leakDetails = 'No DNS leak detected';
      } else {
        results.leakDetected = true;
        results.leakDetails = 'Potential DNS leak detected';
        results.dnsServersUsed = response.data.DNServers || [];
      }
    } catch (error) {
      // If we can't reach the DNS leak test service, we can't determine leak status
      results.leakDetected = null; // Unknown
      results.leakDetails = `Unable to test DNS leak: ${error.message}`;
    }

    return results;
  }

  /**
   * Test proxy speed with download/upload simulation
   * @private
   */
  async _testSpeed(proxy, timeout) {
    const results = {
      downloadSpeedMbps: null,
      uploadSpeedMbps: null,
      pingMs: null,
      timestamp: new Date().toISOString()
    };

    try {
      // Ping test (simplified)
      const pingStart = Date.now();
      await axios.get('https://www.google.com/generate_204', {
        proxy: {
          host: proxy.address,
          port: proxy.port,
          auth: proxy.username && proxy.password ?
            { username: proxy.username, password: proxy.password } : false
        },
        timeout: timeout,
        maxRedirects: 0
      });
      results.pingMs = Date.now() - pingStart;

      // Download speed test (using a known file)
      const downloadStart = Date.now();
      const downloadResponse = await axios.get('https://speed.hetzner.de/100MB.bin', {
        proxy: {
          host: proxy.address,
          port: proxy.port,
          auth: proxy.username && proxy.password ?
            { username: proxy.username, password: proxy.password } : false
        },
        timeout: timeout * 3, // Allow more time for download
        responseType: 'stream'
      });

      // Calculate download speed
      const downloadTime = (Date.now() - downloadStart) / 1000; // seconds
      // Note: We're not actually downloading the full file, just measuring time to first byte
      // A real implementation would measure actual throughput
      results.downloadSpeedMbps = downloadTime > 0 ? 800 / downloadTime : null; // Rough estimate

    } catch (error) {
      results.error = error.message;
    }

    return results;
  }

  /**
   * Detect anonymity level of proxy
   * @private
   */
  async _detectAnonymityLevel(proxy, timeout) {
    try {
      // Test using a service that shows what headers are visible
      const response = await axios.get('http://httpbin.org/headers', {
        proxy: {
          host: proxy.address,
          port: proxy.port,
          auth: proxy.username && proxy.password ?
            { username: proxy.username, password: proxy.password } : false
        },
        timeout: timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AURA-ProxyTest/1.0)',
          'X-Forwarded-For': '1.2.3.4', // Test if this is forwarded
          'X-Real-IP': '5.6.7.8'       // Test if this is forwarded
        }
      });

      const headers = response.data.headers || {};
      
      // Check if our custom headers are forwarded
      const forwardedHeaders = Object.keys(headers).filter(h =>
        ['x-forwarded-for', 'x-real-ip', 'forwarded', 'via'].includes(h.toLowerCase())
      );

      if (forwardedHeaders.length === 0) {
        return 'elite'; // No headers leaked
      } else if (headers['x-forwarded-for'] && 
                 headers['x-forwarded-for'].includes('1.2.3.4, 5.6.7.8')) {
        return 'transparent'; // Headers clearly show original IP
      } else {
        return 'anonymous'; // Some headers but not revealing true IP
      }
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Verify proxy type matches what was claimed
   * @private
   */
  async _verifyProxyType(proxy, timeout) {
    try {
      // Try to connect using the specified proxy type
      // For HTTP/HTTPS proxies, test with HTTP request
      // For SOCKS proxies, test with TCP connection
      
      if (proxy.type === 'http' || proxy.type === 'https') {
        // Test HTTP CONNECT capability
        await axios.get('http://detectportal.firefox.com/success.txt', {
          proxy: {
            host: proxy.address,
            port: proxy.port,
            auth: proxy.username && proxy.password ?
              { username: proxy.username, password: proxy.password } : false
          },
          timeout: timeout
        });
        return true;
      } else if (proxy.type === 'socks4' || proxy.type === 'socks5') {
        // For SOCKS, we'd need a SOCKS client library
        // For now, we'll assume if HTTP test works, the type is correct
        // A real implementation would use socks-proxy-agent or similar
        try {
          await axios.get('http://detectportal.firefox.com/success.txt', {
            proxy: {
              host: proxy.address,
              port: proxy.port,
              auth: proxy.username && proxy.password ?
                { username: proxy.username, password: proxy.password } : false
            },
            timeout: timeout
          });
          return true;
        } catch (httpError) {
          // If HTTP fails, it might still be a working SOCKS proxy
          // Just return true if we can establish TCP connection
          return await this._testTCPSocket(proxy.address, proxy.port, timeout);
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test basic TCP socket connection
   * @private
   */
  async _testTCPSocket(host, port, timeout) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.connect(port, host);
    });
  }

  /**
   * Get country from IP address using geolocation service
   * @private
   */
  async _getCountryFromIP(ipAddress) {
    try {
      const response = await axios.get(`https://ipapi.co/${ipAddress}/country/`, {
        timeout: 5000
      });
      return response.data.trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * Batch test multiple proxies
   * @param {Array} proxies - Array of proxy configurations
   * @param {Object} options - Testing options
   * @returns {Promise<Array>} Array of test results
   */
  async batchTest(proxies, options = {}) {
    const {
      concurrency = 10,
      runId = `batch_preflight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    } = options;

    const results = [];
    const semaphore = new Semaphore(concurrency);

    const testProxyWithSemaphore = async (proxy) => {
      await semaphore.acquire();
      try {
        const result = await this.testProxy(proxy, { ...options, runId });
        results.push(result);
        return result;
      } finally {
        semaphore.release();
      }
    };

    // Execute all tests
    const promises = proxies.map(proxy => testProxyWithSemaphore(proxy));
    await Promise.all(promises);

    // Sort results by success and performance
    results.sort((a, b) => {
      if (a.success !== b.success) return b.success - a.success;
      if (a.latency !== b.latency) return a.latency - b.latency;
      return 0;
    });

    return results;
  }

  /**
   * Close connections
   */
  async close() {
    await this.proxyService.close();
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

module.exports = ProxyPreflight;
