# A.U.R.A Roadmap

## Current Scope

A.U.R.A is currently a Recon & Discovery tool only.

Do not add agentic analysis, exploit generation, triage, or report writing until the recon data model and dashboard are stable.

## Near-Term Work

1. Improve target creation from the UI.
2. Add provider registry for asset discovery:
   - WhoisXMLAPI Reverse WHOIS
   - WHOIS history
   - reverse DNS
   - ASN/netblock sources
   - additional certificate transparency sources
3. Add a normalized `recon_assets` or `resolved_assets` view/table for promoted assets.
4. Improve full recon orchestration:
   - phase toggles
   - per-phase timeout
   - per-tool concurrency
   - stop/cancel support
   - resume support
5. Add generated wordlist previews and download/open links.
6. Add import/export:
   - paste domains
   - upload domain list
   - export domains, URLs, params, services, screenshots index
7. Add stronger tech detection:
   - keep `httpx -tech-detect` as fast baseline
   - add optional headless browser pass
   - evaluate Wappalyzer engine/package rather than automating the Chrome extension UI
8. Add screenshot browser:
   - thumbnails
   - status/title/tech beside screenshot
   - links to local reports

## Later

- Agentic analysis layer.
- LLM-assisted prioritization.
- Vulnerability hypothesis generation.
- Report drafting.
- Integrations with bug bounty program metadata.

## Data Rules

- Do not store huge wordlist content in SQLite.
- Store paths and metadata for external wordlists.
- Store generated small/derived wordlists as files under `data/wordlists/generated/`.
- Store discovered facts in normalized DB tables.
- Keep local DB and generated recon artifacts ignored by Git.
