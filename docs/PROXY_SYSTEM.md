# A.U.R.A Proxy System Documentation

## Overview

The A.U.R.A Proxy System is a modular, intelligent proxy management framework designed to enhance the robustness of reconnaissance operations by providing automatic proxy rotation, block detection, and preflight validation. The system integrates seamlessly with A.U.R.A's existing architecture and provides both programmatic API and web-based management interfaces.

## System Architecture

The proxy system consists of six core modules:

1. **Proxy Store** (`src/db/proxy-store.js`) - SQLite persistence layer
2. **Proxy Service** (`src/recon/proxy-service.js`) - Core business logic
3. **Proxy Preflight** (`src/recon/proxy-preflight.js`) - Comprehensive testing engine
4. **Proxy Sources** (`src/recon/proxy-sources.js`) - Remote proxy fetching
5. **Proxy Detection** (`src/recon/proxy-detection.js`) - Block detection and analysis
6. **Proxy Routes** (`src/web/proxy-routes.js`) - RESTful API endpoints

## Component Details

### 1. Proxy Store

Handles all database operations for proxy information and metrics.

**Database Schema:**
- `proxies` table: Stores proxy configuration (address, port, type, credentials, status)
- `proxy_metrics` table: Stores performance metrics (latency, success rate, failure counts)
- `proxy_test_runs` table: Logs individual test results for historical analysis

**Key Methods:**
- `addProxy(address, port, type, metadata)` - Add or update a proxy
- `updateProxyStatus(proxyId, status, metrics)` - Update proxy status and metrics
- `getActiveProxies()` - Retrieve all active proxies
- `getBestProxies(count, filters)` - Get top-performing proxies based on criteria
- `getProxyMetrics(proxyId)` - Retrieve metrics for a specific proxy
- `recordTestRun(runId, proxyId, targetUrl, success, latencyMs, errorMessage, httpStatus)` - Log test results
- `deleteProxy(proxyId)` - Remove a proxy from the system

### 2. Proxy Service

Implements the core business logic for proxy management including preflight testing, rotation strategies, and block detection.

**Key Features:**
- **Preflight Testing**: Validates proxies against multiple targets (ipify, Google, Cloudflare)
- **Rotation Strategies**: 
  - Smart: Weighted selection based on success rate and latency
  - Round-robin: Sequential distribution
  - Random: Probabilistic selection
  - Performance: Based on historical metrics
- **Block Detection**: Analyzes HTTP responses and content for blocking indicators
- **Tool Integration**: Generates proxy environment variables and native proxy arguments for tools

**Public API:**
- `preflightProxy(proxy, options)` - Test a single proxy
- `batchPreflight(proxies, options)` - Test multiple proxies with concurrency control
- `detectBlockage(response, body)` - Detect blocking in HTTP responses
- `getNextProxy(lastFailedProxy, context)` - Get next proxy for rotation
- `getProxyEnvVars(proxy)` - Get environment variables for tool execution
- `getProxyAgentOptions(proxy)` - Get HTTP agent options for libraries like axios

### 3. Proxy Preflight

Provides comprehensive proxy validation beyond basic connectivity.

**Validation Tests:**
- **Connectivity**: HTTP/HTTPS/SOCKS testing against multiple endpoints
- **DNS Leak Test**: Checks for DNS resolution leaks
- **Speed Test**: Measures download/upload latency and throughput
- **Anonymity Detection**: Determines proxy anonymity level (transparent, anonymous, elite)
- **Type Verification**: Confirms proxy protocol matches claimed type

**Usage:**
```javascript
const ProxyPreflight = require('./src/recon/proxy-preflight');

const preflight = new ProxyPreflight();

// Test single proxy
const result = await preflight.testProxy({
  address: '1.2.3.4',
  port: 8080,
  type: 'socks5',
  username: 'user',
  password: 'pass'
});

// Batch test
const results = await preflight.batchTest([proxy1, proxy2, proxy3], {
  concurrency: 10,
  runId: 'my-test-run'
});
```

### 4. Proxy Sources

Fetches proxy lists from various external sources with format conversion.

**Supported Sources:**
- **spys.one**: Free proxy list with filtering by type, country, anonymity, speed
- **GitHub**: Raw proxy lists from repositories
- **Manual Upload**: TXT, JSON, CSV format parsing

**Usage:**
```javascript
const ProxySources = require('./src/recon/proxy-sources');

const sources = new ProxySources();

// Fetch from spys.one with filters
const proxies = await sources.fetchFromSpysOne({
  proxyType: ['socks4', 'socks5'],
  country: 'US',
  anonymity: 'high',
  speed: 2.0, // seconds
  limit: 50
});

// Fetch from GitHub
const githubProxies = await sources.fetchFromGitHub(
  'https://github.com/username/proxy-list',
  'main'
);

// Parse uploaded content
const txtProxies = sources.parseTxtFile(content);
const jsonProxies = sources.parseJsonFile(content);
const csvProxies = sources.parseCsvFile(content);
```

### 5. Proxy Detection

Analyzes responses to detect blocking and provides intelligent response recommendations.

**Detection Capabilities:**
- **HTTP Status Codes**: 403, 429, 503, 502, 504
- **Content Patterns**: Access denied, rate limiting, CAPTCHA, Cloudflare, DDoS protection
- **Headers**: Server, rate-limit, retry-after indicators
- **Severity Scoring**: Low/Medium/High based on blocking confidence
- **Pattern Analysis**: Tracks blocking trends over time for predictive insights

**Usage:**
```javascript
const ProxyDetection = require('./src/recon/proxy-detection');

const detector = new ProxyDetection();

// Detect blocking in response
const result = detector.detectBlockage(response, responseBody, {
  sensitivity: 'medium',
  checkHeaders: true,
  checkContent: true,
  checkStatus: true
});

// Analyze historical patterns
const analysis = detector.analyzePatterns(detectionHistory);
```

### 6. Proxy Routes

RESTful API endpoints for managing the proxy system through HTTP.

**Endpoints:**

#### Proxy Management
- `GET /api/proxies` - List proxies with filtering and pagination
- `POST /api/proxies` - Add a new proxy
- `GET /api/proxies/:id` - Get specific proxy details
- `PUT /api/proxies/:id` - Update a proxy
- `DELETE /api/proxies/:id` - Delete a proxy

#### Testing & Validation
- `POST /api/proxies/test` - Test single or multiple proxies
- `POST /api/proxies/preflight` - Run preflight test on active proxies

#### Source Management
- `GET /api/proxies/sources` - List available proxy sources
- `POST /api/proxies/sources/:source` - Fetch proxies from specific source

#### Detection & Analytics
- `POST /api/proxies/detect` - Detect blocking in HTTP response
- `GET /api/proxies/stats` - Get proxy usage statistics
- `GET /api/proxies/health` - System health check

**Query Parameters for GET /api/proxies:**
- `status`: Filter by status (active, inactive, all)
- `limit`: Number of results to return (default: 50)
- `offset`: Pagination offset
- `sortBy`: Field to sort by (success_rate, latency_ms, etc.)
- `sortOrder`: asc or desc
- `type`: Proxy type filter (http, https, socks4, socks5)
- `country`: Country code filter
- `minSuccessRate`: Minimum success rate (0.0-1.0)
- `maxLatency`: Maximum latency in milliseconds

## Integration with A.U.R.A

### Tool Runner Integration

The proxy system integrates with A.U.R.A's tool runners through the enhanced `WslToolRunner` class in `src/recon/tool-runners.js`.

**Usage in Tool Execution:**
```javascript
// In recon-engine.js or similar
const WslToolRunner = require('./src/recon/tool-runners');

const runner = new WslToolRunner({ distro: 'kali-linux' });

// Execute tool with proxy
const result = await runner.run({
  tool: { binary: 'nmap' },
  args: ['-sS', '-T4', 'example.com'],
  proxy: {
    address: '1.2.3.4',
    port: 1080,
    type: 'socks5',
    username: 'user',
    password: 'pass'
  },
  useProxy: true, // Enable proxy usage
  timeoutMs: 180000
});
```

The tool runner automatically:
1. Sets HTTP_PROXY/HTTPS_PROXY environment variables
2. Adds native proxy arguments to tools that support them (nmap, ffuf, gobuster, etc.)
3. Returns proxy usage information in the result

### API Route Integration

Proxy routes are integrated into the main API server in `src/web/api-routes.js`:

```javascript
// Add this near the top of the file
const proxyRoutes = require('./proxy-routes');

// Add this in handleApiRequest function
if (url.pathname.startsWith('/api/proxies/')) {
  return proxyRoutes.handleApiRequest({ request, response, url, store });
}
```

## Configuration

### Database Setup

The proxy system uses SQLite and automatically creates the database file at:
```
/home/locu/A.U.R.A/data/proxies.db
```

No manual configuration is required - the database is initialized on first use.

### Environment Variables

No specific environment variables are required for the proxy system to function. However, for optimal performance:

- Ensure sufficient disk space for the SQLite database
- Consider increasing ulimits if planning to test thousands of proxies concurrently

## Usage Examples

### 1. Basic Proxy Management via API

```bash
# Add a new proxy
curl -X POST http://localhost:31338/api/proxies \
  -H "Content-Type: application/json" \
  -d '{
    "address": "1.2.3.4",
    "port": 8080,
    "type": "socks5",
    "username": "myuser",
    "password": "mypass"
  }'

# List active proxies
curl http://localhost:31338/api/proxies?status=active

# Test a proxy
curl -X POST http://localhost:31338/api/proxies/test \
  -H "Content-Type: application/json" \
  -d '{
    "proxies": [{
      "address": "1.2.3.4",
      "port": 8080,
      "type": "socks5"
    }],
    "options": {
      "concurrency": 5
    }
  }'
```

### 2. Using Proxies in Reconnaissance

When creating a target or launching a recon run through the A.U.R.A interface, you can specify proxy usage:

1. Through the web UI: Enable "Use Proxy" in target/recon configuration
2. Through the API: Include `proxyUrl` or `proxy` object in requests
3. Programmatically: Use the `WslToolRunner` with proxy options as shown above

### 3. Automatic Block Handling

The recon engine automatically:
1. Detects blocking responses using `ProxyDetection`
2. Logs blocking events to the AI decision log
3. Initiates proxy rotation via `ProxyService.getNextProxy()`
4. Retries failed operations with the new proxy
5. Escalates to human intervention if blocking persists

## Extending the System

### Adding New Proxy Sources

To add a new proxy source:
1. Extend the `ProxySources` class in `src/recon/proxy-sources.js`
2. Add a new method following the naming convention `fetchFrom[SourceName]`
3. Add the source to the `sources` object in the constructor
4. Add API endpoint in `src/web/proxy-routes.js` if desired

### Adding New Test Targets

To add new preflight test targets:
1. Modify the `testTargets` object in `src/recon/proxy-preflight.js`
2. Add new protocol-specific test arrays or extend existing ones
3. Each target should have: `name`, `url` (or `type` for DNS), `timeout`, and optional `followRedirect`, `validateStatus`

### Customizing Rotation Strategies

To implement a new rotation strategy:
1. Add a new method to `ProxyService` class (e.g., `_getWeightedRandomProxy`)
2. Add the strategy name to the switch statement in `getNextProxy()`
3. Implement the selection logic based on your criteria

## Security Considerations

1. **Credential Storage**: Proxy credentials are stored in the SQLite database. Ensure proper file permissions on the data directory.
2. **API Access**: The proxy management API should be protected by the same authentication mechanisms as the rest of A.U.R.A.
3. **Proxy Trust**: Only use proxies from trusted sources, as malicious proxies can intercept and modify traffic.
4. **Rate Limiting**: Consider implementing API rate limiting for proxy management endpoints in production deployments.

## Troubleshooting

### Common Issues

1. **Database Lock Errors**:
   - Ensure no other processes are accessing the database simultaneously
   - Consider increasing SQLite timeout in the connection settings

2. **Proxy Test Failures**:
   - Verify proxy credentials and connectivity
   - Check if the proxy type matches the actual protocol (HTTP vs SOCKS)
   - Test with manual tools (curl, telnet) to verify proxy functionality

3. **API Endpoint Not Found**:
   - Ensure the proxy routes are properly registered in `api-routes.js`
   - Check server logs for initialization errors

4. **Tool Proxy Integration Not Working**:
   - Verify the tool supports the proxy method being used (environment variables vs native flags)
   - Check tool documentation for specific proxy syntax requirements
   - Test with `--proxy` or `-x` flags manually to confirm format

### Logging

The proxy system logs to standard A.U.R.A logging channels:
- Database errors: Logged as errors
- Test results: Available through API endpoints
- Blocking events: Logged to AI decision log for analysis
- Operational info: Logged at info level during normal operations

## Performance Guidelines

1. **Batch Testing Size**: For optimal performance, test proxies in batches of 10-50 depending on system resources
2. **Concurrency**: Start with concurrency of 5-10 and adjust based on network capacity and target responsiveness
3. **Database Indexing**: The proxy store includes indices on frequently queried columns (status, last_tested, proxy_id)
4. **Cache Considerations**: For high-frequency access, consider implementing a caching layer for frequently used proxy lists

## Future Enhancements

Planned improvements for future versions:
1. **Geographic Load Balancing**: Route requests through proxies in specific geographic regions
2. **Protocol Adaptation**: Automatic switching between HTTP/HTTPS/SOCKS based on target requirements
3. **Integration with Threat Intelligence**: Automatic proxy reputation checking
4. **WebSocket Support**: Extended proxy testing for WebSocket connections
5. **SOCKS Authentication**: Enhanced support for SOCKS4A and SOCKS5 authentication methods
6. **DNS-over-Proxy**: Specialized testing for DNS queries routed through proxies

---
*Documentation generated for A.U.R.A Proxy System v1.0*