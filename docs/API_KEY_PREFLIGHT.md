# API Key Preflight

A.U.R.A supports provider-specific API key preflight checks from Settings > API Keys.

## Workflow

- Saving a key runs the configured provider preflight.
- The API key list has a row-level Test action for checking one stored key.
- Test All API Keys remains available for a full credential health pass.
- Successful checks mark the key `active`.
- Failed checks mark the key `failed` and keep the provider message visible in the preflight panel.

## Provider Notes

ZoomEye uses the current `https://api.zoomeye.ai` API host for preflight and web search calls. This avoids the older regional endpoint that can return a 403 area-availability message.

WhoisFreaks can be added as provider `whoisfreaks`. A.U.R.A uses it as a
historical WHOIS fallback when current RDAP/WHOIS records are private, redacted,
or do not produce useful target-related pivots.

## UI Density

The API key table uses a compact row layout so status, usage, Test, and Delete actions remain visible without excessive spacing.
