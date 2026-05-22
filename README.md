# A.U.R.A

A.U.R.A is a local Recon & Discovery dashboard for authorized bug bounty and security research scopes.

Current focus:

- target configuration
- single domain, domain list, and full recon modes
- certificate transparency and passive source collection
- Reverse WHOIS asset discovery
- WSL/Kali tool orchestration
- domains, URLs, parameters, HTTP services, technologies, screenshots, API keys, and wordlists persisted locally

Run:

```powershell
npm test
npm run web
```

Create a target:

```powershell
npm run target:new -- yahoo
```

The dashboard runs at:

```text
http://127.0.0.1:31338
```
