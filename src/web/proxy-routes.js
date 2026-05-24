// Proxy Routes - API endpoints for proxy management
// Provides RESTful API for proxy configuration, testing, and monitoring

const express = require('express');
const router = express.Router();
const ProxyService = require('../recon/proxy-service');
const ProxyPreflight = require('../recon/proxy-preflight');
const ProxySources = require('../recon/proxy-sources');
const ProxyDetection = require('../recon/proxy-detection');

let proxyService = null;
let proxyPreflight = null;
let proxySources = null;
let proxyDetection = null;

// Initialize services
function initServices() {
  if (!proxyService) {
    proxyService = new ProxyService();
    proxyPreflight = new ProxyPreflight();
    proxySources = new ProxySources();
    proxyDetection = new ProxyDetection();
  }
}

// Middleware to ensure services are initialized
router.use((req, res, next) => {
  initServices();
  next();
});

/**
 * GET /api/proxies
 * Get list of proxies with optional filtering
 */
router.get('/', async (req, res) => {
  try {
    const {
      status = 'active',
      limit = 50,
      offset = 0,
      sortBy = 'success_rate',
      sortOrder = 'desc',
      type = null,
      country = null,
      minSuccessRate = null,
      maxLatency = null
    } = req.query;

    let proxies;
    if (status === 'all') {
      proxies = await proxyService.store.getBestProxies(parseInt(limit), {
        minSuccessRate: minSuccessRate ? parseFloat(minSuccessRate) : 0,
        maxLatency: maxLatency ? parseInt(maxLatency) : null,
        proxyType: type,
        country: country
      });
    } else {
      // For now, we'll use getActiveProxies and filter later
      // A more sophisticated implementation would have direct DB queries with filters
      proxies = await proxyService.store.getActiveProxies();
      
      // Apply filters
      if (type) proxies = proxies.filter(p => p.type === type);
      if (country) proxies = proxies.filter(p => p.country === country.toUpperCase());
      if (minSuccessRate !== null) proxies = proxies.filter(p => (p.success_rate || 0) >= parseFloat(minSuccessRate));
      if (maxLatency !== null) proxies = proxies.filter(p => (p.latency_ms || Infinity) <= parseInt(maxLatency));
    }

    // Apply pagination
    const start = parseInt(offset);
    const end = start + parseInt(limit);
    const paginated = proxies.slice(start, end);

    res.json({
      proxies: paginated,
      total: proxies.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies
 * Add a new proxy
 */
router.post('/', async (req, res) => {
  try {
    const { address, port, type, country, username, password } = req.body;

    if (!address || !port || !type) {
      return res.status(400).json({ 
        error: 'Address, port, and type are required' 
      });
    }

    const proxyId = await proxyService.store.addProxy(
      address,
      parseInt(port),
      type,
      {
        country: country || null,
        username: username || null,
        password: password || null,
        status: 'unknown'
      }
    );

    res.status(201).json({ 
      id: proxyId,
      message: 'Proxy added successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/proxies/:id
 * Get a specific proxy by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const proxyId = parseInt(req.params.id);
    const proxy = await proxyService.store.db.get(
      `SELECT * FROM proxies WHERE id = ?`,
      [proxyId]
    );

    if (!proxy) {
      return res.status(404).json({ error: 'Proxy not found' });
    }

    // Get metrics
    const metrics = await proxyService.store.getProxyMetrics(proxyId);

    res.json({
      ...proxy,
      metrics: metrics || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/proxies/:id
 * Update a proxy
 */
router.put('/:id', async (req, res) => {
  try {
    const proxyId = parseInt(req.params.id);
    const { address, port, type, country, username, password, status } = req.body;

    // Check if proxy exists
    const existing = await proxyService.store.db.get(
      `SELECT * FROM proxies WHERE id = ?`,
      [proxyId]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Proxy not found' });
    }

    // Update proxy
    await proxyService.store.db.run(
      `UPDATE proxies SET 
       address = COALESCE(?, address),
       port = COALESCE(?, port),
       type = COALESCE(?, type),
       country = COALESCE(?, country),
       username = COALESCE(?, username),
       password = COALESCE(?, password),
       status = COALESCE(?, status),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        address || undefined,
        port !== undefined ? parseInt(port) : undefined,
        type || undefined,
        country || undefined,
        username || undefined,
        password || undefined,
        status || undefined,
        proxyId
      ]
    );

    res.json({ message: 'Proxy updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/proxies/:id
 * Delete a proxy
 */
router.delete('/:id', async (req, res) => {
  try {
    const proxyId = parseInt(req.params.id);
    const deleted = await proxyService.store.deleteProxy(proxyId);

    if (!deleted) {
      return res.status(404).json({ error: 'Proxy not found' });
    }

    res.json({ message: 'Proxy deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies/test
 * Test a single proxy or list of proxies
 */
router.post('/test', async (req, res) => {
  try {
    const { proxies, options = {} } = req.body;

    if (!proxies || !Array.isArray(proxies) || proxies.length === 0) {
      return res.status(400).json({ 
        error: 'Proxies array is required' 
      });
    }

    // Test each proxy
    const results = await proxyPreflight.batchTest(proxies, options);

    res.json({
      results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        averageLatency: results.reduce((sum, r) => sum + (r.latency || 0), 0) / results.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies/preflight
 * Run preflight test on active proxies
 */
router.post('/preflight', async (req, res) => {
  try {
    const { options = {} } = req.body;

    // Get active proxies
    const proxies = await proxyService.store.getActiveProxies();

    if (proxies.length === 0) {
      return res.status(400).json({ 
        error: 'No active proxies to test' 
      });
    }

    // Run preflight test
    const results = await proxyPreflight.batchTest(proxies, options);

    res.json({
      results,
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        averageLatency: results.reduce((sum, r) => sum + (r.latency || 0), 0) / results.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/proxies/sources
 * Get list of available proxy sources
 */
router.get('/sources', async (req, res) => {
  try {
    const sources = [
      {
        id: 'spysone',
        name: 'spys.one',
        description: 'Free proxy list from spys.one with filtering options',
        supportsFilters: true,
        filterOptions: {
          proxyType: ['http', 'https', 'socks4', 'socks5'],
          country: ['US', 'DE', 'FR', 'GB', 'CA', 'NL', 'RU', 'JP', 'AU', 'SE'],
          anonymity: ['high', 'medium', 'low'],
          speed: [0.5, 1, 2, 5, 10] // seconds
        }
      },
      {
        id: 'github',
        name: 'GitHub Raw',
        description: 'Fetch proxy list from GitHub repository (raw file)',
        supportsFilters: false
      },
      {
        id: 'txt',
        name: 'Text File',
        description: 'Upload plain text file with proxy list (one per line)',
        supportsFilters: false
      },
      {
        id: 'json',
        name: 'JSON File',
        description: 'Upload JSON file with proxy list',
        supportsFilters: false
      },
      {
        id: 'csv',
        name: 'CSV File',
        description: 'Upload CSV file with proxy list',
        supportsFilters: false
      }
    ];

    res.json({ sources });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies/sources/:source
 * Fetch proxies from a specific source
 */
router.post('/sources/:source', async (req, res) => {
  try {
    const { source } = req.params;
    const { params = {} } = req.body;

    let proxies;
    switch (source.toLowerCase()) {
      case 'spysone':
        proxies = await proxySources.fetchFromSpysOne(params);
        break;
      case 'github':
        if (!params.url) {
          return res.status(400).json({ error: 'GitHub URL is required' });
        }
        proxies = await proxySources.fetchFromGitHub(params.url, params.branch || 'main');
        break;
      case 'txt':
        if (!params.content) {
          return res.status(400).json({ error: 'Text content is required' });
        }
        proxies = proxySources.parseTxtFile(params.content);
        break;
      case 'json':
        if (!params.content) {
          return res.status(400).json({ error: 'JSON content is required' });
        }
        proxies = proxySources.parseJsonFile(params.content);
        break;
      case 'csv':
        if (!params.content) {
          return res.status(400).json({ error: 'CSV content is required' });
        }
        proxies = proxySources.parseCsvFile(params.content);
        break;
      default:
        return res.status(400).json({ error: `Unsupported source: ${source}` });
    }

    // Add fetched proxies to database
    const added = [];
    for (const proxy of proxies) {
      try {
        const proxyId = await proxyService.store.addProxy(
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
        added.push({ ...proxy, id: proxyId });
      } catch (proxyError) {
        // Skip duplicates or invalid proxies
        continue;
      }
    }

    res.json({
      fetched: proxies.length,
      added: added.length,
      proxies: added
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/proxies/detect
 * Detect blocking in a response
 */
router.post('/detect', async (req, res) => {
  try {
    const { response, body } = req.body;

    if (!response) {
      return res.status(400).json({ error: 'Response object is required' });
    }

    const detection = proxyDetection.detectBlockage(response, body || '');

    res.json({ detection });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/proxies/stats
 * Get proxy statistics
 */
router.get('/stats', async (req, res) => {
  try {
    // Get basic counts
    const counts = await proxyService.store.db.all(`
      SELECT 
        status,
        COUNT(*) as count
      FROM proxies
      GROUP BY status
    `);

    // Get average success rate and latency
    const averages = await proxyService.store.db.get(`
      SELECT 
        AVG(success_rate) as avg_success_rate,
        AVG(latency_ms) as avg_latency,
        COUNT(*) as total_with_metrics
      FROM proxy_metrics
    `);

    // Get recent test runs
    const recentTests = await proxyService.store.db.all(`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as total_tests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_tests
      FROM proxy_test_runs
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `);

    res.json({
      counts: counts.reduce((acc, row) => {
        acc[row.status] = row.count;
        return acc;
      }, {}),
      averages: {
        successRate: averages.avg_success_rate || 0,
        latencyMs: averages.avg_latency || 0,
        totalWithMetrics: averages.total_with_metrics || 0
      },
      recentTests: recentTests
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/proxies/health
 * Health check for proxy system
 */
router.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbHealth = await new Promise((resolve, reject) => {
      proxyService.store.db.get('SELECT 1 as health', (err, row) => {
        if (err) reject(err);
        else resolve(row.health === 1);
      });
    });

    // Check if we have any proxies
    const proxyCount = await proxyService.store.db.get(
      'SELECT COUNT(*) as count FROM proxies'
    );

    res.json({
      status: dbHealth && proxyCount.count > 0 ? 'healthy' : 'degraded',
      database: dbHealth ? 'connected' : 'disconnected',
      proxyCount: proxyCount.count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Cleanup on router removal
router.use((err, req, res, next) => {
  if (err) {
    console.error('Proxy API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
