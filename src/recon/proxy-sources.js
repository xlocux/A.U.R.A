// Proxy Sources - Module for fetching proxy lists from various sources
// Supports spys.one, GitHub raw files, and custom APIs

const axios = require('axios');
const cheerio = require('cheerio');
const { Parser } = require('json2csv');
const url = require('url');

class ProxySources {
  constructor() {
    this.sources = {
      spysOne: this.fetchFromSpysOne.bind(this),
      github: this.fetchFromGitHub.bind(this),
      txt: this.parseTxtFile.bind(this),
      json: this.parseJsonFile.bind(this),
      csv: this.parseCsvFile.bind(this)
    };
  }

  /**
   * Fetch proxies from spys.one with filtering
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Array of proxy objects
   */
  async fetchFromSpysOne(filters = {}) {
    const {
      proxyType = ['socks4', 'socks5'], // Array or string
      country = null, // Country code (US, DE, etc.)
      anonymity = null, // Level of anonymity
      speed = null, // Maximum response time in seconds
      limit = 100 // Maximum number of proxies to return
    } = filters;

    try {
      # spys.one requires POST request with specific parameters
      const response = await axios.post('http://spys.one/proxies/', {
        xpp: 5, # Main table
        xp: proxyType.includes('socks5') ? 4 : (proxyType.includes('socks4') ? 3 : 0), # Proxy type
        xcn: country ? this._countryCodeToNumber(country) : 0, # Country
        xan: anonymity || 0, # Anonymity level
        xsp: speed ? this._speedToNumber(speed) : 0, # Speed
        xpt: 0 # Proxy type (0 = all)
      });

      const $ = cheerio.load(response.data);
      const proxies = [];

      # Parse the proxy table
      $('#spy > table > tbody > tr').each((index, element) => {
        if (index === 0) return; # Skip header row

        const cells = $(element).find('td');
        if (cells.length < 2) return;

        const proxyText = $(cells[0]).text().trim();
        const detailsText = $(cells[1]).text().trim();

        # Extract IP:PORT
        const proxyMatch = proxyText.match(/^(\d+\.\d+\.\d+\.\d+):(\d+)/);
        if (!proxyMatch) return;

        const address = proxyMatch[1];
        const port = parseInt(proxyMatch[2], 10);

        # Extract proxy type
        const typeMatch = detailsText.match(/@(HTTP|SOCKS4|SOCKS5)/i);
        const type = typeMatch ? typeMatch[1].toLowerCase() : 'unknown';

        # Extract country
        const countryMatch = detailsText.match(/([A-Z]{2})\s*-\s*/);
        const countryCode = countryMatch ? countryMatch[1] : null;

        # Extract anonymity level
        const anonymityMatch = detailsText.match(/\((High|Low|Medium)\)/i);
        const anonymityLevel = anonymityMatch ? anonymityMatch[1].toLowerCase() : 'unknown';

        # Extract speed
        const speedMatch = detailsText.match(/(\d+\.?\d*)\s*sec/);
        const speedSec = speedMatch ? parseFloat(speedMatch[1]) : null;

        # Apply filters
        if (proxyType && !proxyType.includes(type)) return;
        if (country && countryCode !== country.toUpperCase()) return;
        if (anonymity && anonymityLevel !== anonymity.toLowerCase()) return;
        if (speed !== null && speedSec !== null && speedSec > speed) return;

        proxies.push({
          address,
          port,
          type,
          country: countryCode,
          anonymity: anonymityLevel,
          speed: speedSec,
          source: 'spys.one',
          lastChecked: new Date().toISOString()
        });

        # Respect limit
        if (proxies.length >= limit) return false; # Break cheerio.each
      });

      return proxies;
    } catch (error) {
      throw new Error(`Failed to fetch from spys.one: ${error.message}`);
    }
  }

  /**
   * Fetch proxies from GitHub raw file
   * @param {string} repoUrl - GitHub repository URL (raw content)
   * @param {string} branch - Branch name (default: main)
   * @returns {Promise<Array>} Array of proxy objects
   */
  async fetchFromGitHub(repoUrl, branch = 'main') {
    try {
      # Convert GitHub URL to raw content URL
      let rawUrl = repoUrl;
      if (repoUrl.includes('github.com')) {
        # Extract user/repo from GitHub URL
        const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (match) {
          const [, user, repo] = match;
          rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/proxies.txt`;
        }
      }

      const response = await axios.get(rawUrl, {
        timeout: 10000
      });

      return this._parseProxyText(response.data);
    } catch (error) {
      throw new Error(`Failed to fetch from GitHub: ${error.message}`);
    }
  }

  /**
   * Parse proxy list from text format
   * @param {string} content - Text content containing proxies
   * @returns {Array} Array of proxy objects
   */
  parseTxtFile(content) {
    return this._parseProxyText(content);
  }

  /**
   * Parse proxy list from JSON format
   * @param {string} content - JSON content containing proxies
   * @returns {Array} Array of proxy objects
   */
  parseJsonFile(content) {
    try {
      const data = JSON.parse(content);
      
      # Handle different JSON formats
      if (Array.isArray(data)) {
        # Array of objects or strings
        return data.map(item => {
          if (typeof item === 'string') {
            # Format: "ip:port" or "ip:port:type"
            return this._parseProxyString(item);
          } else if (typeof item === 'object' && item.address && item.port) {
            # Format: {address: "x.x.x.x", port: 8080, type: "http"}
            return {
              address: item.address,
              port: parseInt(item.port, 10),
              type: item.type || 'http',
              country: item.country || null,
              username: item.username || null,
              password: item.password || null,
              source: 'json_upload',
              lastChecked: new Date().toISOString()
            };
          }
          return null;
        }).filter(Boolean);
      } else if (typeof data === 'object' && data.proxies) {
        # Format: {proxies: [...]}
        return this.parseJsonFile(JSON.stringify(data.proxies));
      }
      
      return [];
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error.message}`);
    }
  }

  /**
   * Parse proxy list from CSV format
   * @param {string} content - CSV content containing proxies
   * @returns {Array} Array of proxy objects
   */
  parseCsvFile(content) {
    try {
      const lines = content.trim().split('\n');
      if (lines.length === 0) return [];

      # Check if first line is header
      const firstLine = lines[0].toLowerCase();
      const hasHeader = firstLine.includes('address') || 
                       firstLine.includes('ip') || 
                       firstLine.includes('host') ||
                       firstLine.includes('port');

      const startIndex = hasHeader ? 1 : 0;
      const proxies = [];

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        # Handle quoted CSV
        const values = line.split(',').map(v => v.replace(/^["']|["']$/g, '').trim());
        
        if (values.length >= 2) {
          const proxy = {
            address: values[0],
            port: parseInt(values[1], 10),
            type: values[2] || 'http',
            country: values[3] || null,
            username: values[4] || null,
            password: values[5] || null,
            source: 'csv_upload',
            lastChecked: new Date().toISOString()
          };

          # Validate
          if (proxy.address && !isNaN(proxy.port) && proxy.port > 0 && proxy.port < 65536) {
            proxies.push(proxy);
          }
        }
      }

      return proxies;
    } catch (error) {
      throw new Error(`Failed to parse CSV: ${error.message}`);
    }
  }

  /**
   * Parse proxy text content (supports multiple formats)
   * @private
   */
  _parseProxyText(content) {
    const lines = content.trim().split('\n');
    const proxies = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue; # Skip empty lines and comments

      const proxy = this._parseProxyString(trimmed);
      if (proxy) {
        proxies.push(proxy);
      }
    }

    return proxies;
  }

  /**
   * Parse a single proxy string (ip:port or ip:port:type)
   * @private
   */
  _parseProxyString(proxyStr) {
    # Support formats:
    # ip:port
    # ip:port:type
    # username:password@ip:port:type
    
    let auth = null;
    let cleanStr = proxyStr;

    # Extract authentication if present
    const authMatch = proxyStr.match(/^([^:@]+):([^:@]+)@(.+)$/);
    if (authMatch) {
      auth = {
        username: authMatch[1],
        password: authMatch[2]
      };
      cleanStr = authMatch[3];
    }

    # Extract address, port, and type
    const parts = cleanStr.split(':');
    if (parts.length < 2) return null;

    const address = parts[0];
    let port = parseInt(parts[1], 10);
    let type = parts[2] || 'http';

    # Validate
    if (!address || isNaN(port) || port <= 0 || port > 65535) return null;
    
    # Normalize proxy type
    type = type.toLowerCase();
    if (!['http', 'https', 'socks4', 'socks5'].includes(type)) {
      type = 'http'; # Default to http
    }

    return {
      address,
      port,
      type,
      username: auth ? auth.username : null,
      password: auth ? auth.password : null,
      source: 'text_parse',
      lastChecked: new Date().toISOString()
    };
  }

  /**
   * Convert country code to spys.one numeric code
   * @private
   */
  _countryCodeToNumber(countryCode) {
    # spys.one uses numeric codes for countries
    # This is a simplified mapping - in reality would need full mapping
    const countryMap = {
      'US': 1, 'DE': 2, 'FR': 3, 'GB': 4, 'CA': 5,
      'NL': 6, 'RU': 7, 'JP': 8, 'AU': 9, 'SE': 10
    };
    return countryMap[countryCode.toUpperCase()] || 0;
  }

  /**
   * Convert speed in seconds to spys.one numeric code
   * @private
   */
  _speedToNumber(speedSec) {
    # spys.one speed codes: 0=any, 1=<0.5s, 2=<1s, 3=<2s, 4=<5s, 5=<10s, 6=>10s
    if (speedSec <= 0.5) return 1;
    if (speedSec <= 1.0) return 2;
    if (speedSec <= 2.0) return 3;
    if (speedSec <= 5.0) return 4;
    if (speedSec <= 10.0) return 5;
    return 6;
  }

  /**
   * Fetch proxies from a source based on type
   * @param {string} sourceType - Type of source (spysone, github, txt, json, csv)
   * @param {*} sourceParams - Parameters for the source
   * @returns {Promise<Array>} Array of proxy objects
   */
  async fetchFromSource(sourceType, sourceParams) {
    const sourceFunc = this.sources[sourceType.toLowerCase()];
    if (!sourceFunc) {
      throw new Error(`Unsupported source type: ${sourceType}`);
    }
    return await sourceFunc(sourceParams);
  }
}

module.exports = ProxySources;