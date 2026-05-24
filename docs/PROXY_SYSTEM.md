# A.U.R.A Proxy System

## Overview

A.U.R.A currently supports explicit, user-configured outbound proxies for WSL
recon tool execution. The feature is intended for authorized interception,
debugging, and lab egress workflows such as routing traffic through Burp.

The active implementation has two layers:

- Proxy configuration lives in the Web UI under `Settings > Proxy`.
- Settings are stored locally in the browser.
- A single selected proxy is passed to recon requests as `proxyUrl`.
- The backend validates the proxy URL before starting a run.
- WSL tool execution exports standard proxy environment variables.
- `/api/proxies` exposes optional server-side proxy inventory, import, TCP
  preflight, detection, stats, and health endpoints.

There is no automatic proxy retry flow in recon execution. Proxy selection for a
recon run remains explicit.

## Supported Schemes

A.U.R.A accepts proxy URLs using these schemes:

- `http`
- `https`
- `socks4`
- `socks5`

Examples:

```text
http://127.0.0.1:8080
socks5://proxy.internal:1080
http://user:pass@127.0.0.1:8080
```

Credentials are redacted in UI and run-event messages.

## Frontend Flow

The frontend module is `public/web/proxy-settings.js`.

Responsibilities:

- Bind the `Settings > Proxy` controls.
- Validate proxy URLs before saving.
- Normalize host-only entries by applying the selected scheme.
- Store settings in `localStorage` under `aura.proxySettings`.
- Maintain an optional manually imported saved-proxy list.
- Expose `window.AuraProxySettings.activeProxyUrl()` for recon forms.

The main UI uses this helper from `public/web/app.js` and includes the active
proxy URL in run-start requests.

## Backend Flow

The backend validates incoming proxy URLs in `src/web/api-routes.js` with
`parseOptionalProxy()`, which delegates to `normalizeProxyUrl()` from
`src/recon/wsl-tools.js`.

The normalized proxy URL is passed into recon execution paths:

- target bootstrap runs
- full recon runs
- HTTP follow-up runs
- technology enrichment tools
- screenshot tools

Invalid proxy URLs fail fast with a `400` response before a run is started.

The server-side proxy API is implemented in `src/web/proxy-routes.js` and is
mounted from `src/web/api-routes.js`. It follows the project's custom HTTP
handler style and does not use Express.

Active modules:

- `src/db/proxy-store.js`: `node:sqlite` persistence for proxy records, metrics,
  and test history.
- `src/recon/proxy-service.js`: proxy formatting, environment variable helpers,
  and conservative proxy selection helpers.
- `src/recon/proxy-preflight.js`: TCP reachability checks with metric storage.
- `src/recon/proxy-sources.js`: manual TXT/JSON/CSV parsing and user-provided
  GitHub raw/blob URL import.
- `src/recon/proxy-detection.js`: response classification and conservative
  operator recommendations.
- `src/web/proxy-routes.js`: custom REST endpoints under `/api/proxies`.

## Tool Execution

WSL tool execution is handled by `runWslTool()` in `src/recon/wsl-tools.js`.

When a proxy URL is supplied, the runner exports:

```sh
HTTP_PROXY
HTTPS_PROXY
ALL_PROXY
http_proxy
https_proxy
all_proxy
```

The selected recon tool then runs in the same shell environment. Tool-specific
behavior still depends on whether that tool honors standard proxy environment
variables.

## UI Configuration

The active controls are defined in `public/web/index.html`:

- `proxyEnabled`
- `proxyUrl`
- `proxySavedList`
- `proxyMode`
- `proxyPurpose`
- `proxyImportList`
- `importProxyList`
- `clearProxyList`
- `saveProxySettings`

The browser saved list is a convenience picker only. Server-side imports through
`/api/proxies/sources/:source` persist entries to `data/proxies.db`.

## API Endpoints

- `GET /api/proxies`
- `POST /api/proxies`
- `GET /api/proxies/:id`
- `PUT /api/proxies/:id`
- `DELETE /api/proxies/:id`
- `POST /api/proxies/test`
- `POST /api/proxies/preflight`
- `GET /api/proxies/sources`
- `POST /api/proxies/sources/:source`
- `POST /api/proxies/detect`
- `GET /api/proxies/stats`
- `GET /api/proxies/health`

## Current Limitations

- Web UI run settings are browser-local unless separately imported through the
  proxy API.
- Only one proxy is active per recon run.
- Proxy preflight currently checks TCP reachability and stores metrics; it does
  not prove that every recon tool will honor the proxy.
- SOCKS support depends on the underlying WSL tool honoring `ALL_PROXY` or the
  corresponding environment variable.

## Quick Verification

Use these checks after proxy-related changes:

```powershell
node --check src/web/api-routes.js
node --check src/recon/wsl-tools.js
node --check src/web/proxy-routes.js
node --check public/web/proxy-settings.js
node -e "require('./src/web/api-routes'); console.log('api routes ok')"
npm test
```

Manual UI check:

1. Open the Web UI.
2. Go to `Settings > Proxy`.
3. Enable proxy routing.
4. Enter `http://127.0.0.1:8080` for Burp or another authorized local proxy.
5. Save settings.
6. Start a recon run and confirm the run event logs the redacted proxy URL.

## Troubleshooting

If traffic is not visible in the proxy:

- Confirm the proxy URL has a supported scheme.
- Confirm the recon tool being used supports proxy environment variables.
- Confirm Burp or the upstream proxy is listening on the configured host and
  port.
- For HTTPS interception, configure the tool or WSL environment to trust the
  interception CA where required.

If the server rejects a run:

- Check the API response for the proxy validation error.
- Re-enter the proxy with an explicit scheme, for example
  `http://127.0.0.1:8080`.
