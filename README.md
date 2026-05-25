# A.U.R.A - Asset Unveiling & Reconnaissance Automation

A.U.R.A is a local-first recon workbench for authorized bug bounty, asset inventory, and security research scopes. It is designed to help an operator move from a small set of authorized seeds to a documented, evidence-backed map of domains, services, URLs, technologies, screenshots, and candidate assets.

A.U.R.A is not an exploit automation framework. The project focuses on discovery, validation, evidence preservation, correlation, triage, and safe follow-up planning. Active checks must stay inside explicitly authorized scope.

## Core Principles

- **Local first**: data is stored locally in SQLite and artifacts are written to the local filesystem.
- **Evidence first**: raw tool output is saved before parsing so every normalized observation can be traced back to source evidence.
- **Scope first**: unknown or weakly correlated assets are review leads, not automatic scan targets.
- **UI first**: target setup, recon controls, API keys, wordlists, run logs, results, exports, and AI assistance are managed from the Web UI.
- **AI assisted, not AI uncontrolled**: the AI explains, summarizes, correlates, and proposes next steps, but A.U.R.A remains the control plane.
- **Modular by design**: sources, parsers, tool runners, provider APIs, wordlists, and UI extensions are separated so new capabilities can be added without growing a monolith.

## Quick Start

A.U.R.A requires Node.js 24 or newer.

```powershell
npm test
npm run web
```

Open:

```text
http://127.0.0.1:31338
```

Default local login on first start:

```text
locu / locu
```

To override the initial password before the first server start:

```powershell
$env:AURA_WEB_PASSWORD="change-me"
npm run web
```

The server binds to `127.0.0.1` by default. Use `--host 0.0.0.0` only on a trusted network and only after changing the default login.

## High-Level Workflow

1. **Prepare environment**
   - Open `Settings > Environment`.
   - Run environment check.
   - Install or update WSL/Kali tools.
   - Confirm that required tools are available.

2. **Configure optional providers**
   - Open `Settings > API Keys`.
   - Add only the provider keys you want to use.
   - Test one key from its row or run `Test All API Keys`.
   - Failed keys stay visible with status so provider coverage is transparent.

3. **Create or select a target**
   - Open `Recon`.
   - Add target name, program URL, in-scope domains/URLs, and out-of-scope values.
   - Wildcards are normalized to root domains where needed.

4. **Choose recon mode and tools**
   - Select single-domain, list, or full recon.
   - Select passive sources, WSL/Kali tools, screenshot tools, API-backed providers, and httpx port preset/custom ports.

5. **Confirm authorization**
   - Active enumeration requires the `Authorized scope` checkbox.
   - Without authorization, A.U.R.A can still perform passive bootstrap/intel checks but should not launch active enumeration.

6. **Run recon**
   - A.U.R.A collects passive evidence, runs selected tools, stores artifacts, parses observations, and updates live run status.

7. **Review results**
   - Use `Results`, `Projects`, `Search`, `Topology`, `Runs & Logs`, and `AI Log`.
   - Review run deltas first to prioritize new assets and changes.

8. **Plan safe follow-up**
   - Use HTTP/Tech follow-up, screenshot follow-up, filtered exports, wordlist generation, or manual review.
   - Candidate assets remain review leads until authorized scope is updated.

## Web UI Tabs

### Recon

The main operation tab. It contains:

- target creation
- active target selector
- authorized seed input
- full recon provider search terms
- WHOIS/RDAP and alternate TLD bootstrap toggle
- WSL distro and timeout settings
- passive source checkboxes
- WSL/Kali tool checkboxes
- screenshot tool checkboxes
- provider lead preview controls
- discovery lead table

### Wordlists

Manages existing wordlists and generated wordlists.

Saved wordlists show:

- name
- category
- status
- size on disk
- line count
- path
- actions

A.U.R.A stores wordlist metadata in SQLite, not large wordlist contents. Generated wordlists are written to:

```text
data/wordlists/generated/
```

### Search

Searches saved domains, URLs, parameters, HTTP services, technologies, sources, and leads. Use it to quickly answer questions such as:

- which assets use a given technology
- which URLs contain a parameter name
- which domains came from a specific source
- which services expose a title/header pattern

### Topology

A visual relationship map for targets, domains, services, URLs, artifacts, candidates, and future graph edges. It supports node inspection, zoom, fit, and layer controls.

### Projects

A compact project/result table view for broad project inspection. It is useful for quickly reviewing large domain/service inventories, source overlap, seen timestamps, and grouped project evidence.

### Results

The main result review area. It contains:

- **Explorer**: tree view of roots, subdomains, services, URLs, technologies, screenshots, and candidate assets.
- **Delta**: new, removed, and stable findings compared with the previous run for the same target.
- **Domains**: saved domain/subdomain observations.
- **Services**: HTTP services, status codes, titles, and technology output.
- **URLs**: archived URLs, paths, and parameters.
- **Tech**: technology aggregation by services and hosts.
- **Screenshots**: screenshot runs, output folders, reports, and image previews.
- **Tool Logs**: raw stdout/stderr artifact references and execution status.
- **Export**: JSON, CSV, Markdown, and filtered view exports.

### AI Log

Records AI-assisted correlation activity separately from the chat. This keeps the AI chat clean while still preserving what the correlation layer inferred, why it scored a lead, and which evidence was used.

### Runs & Logs

Shows current activity, live run events, heartbeats, warnings, retries, and completion state.

### Guide

The in-product operator guide. It explains the workflow, visible sources/tools, correlation techniques, `Not run` states, and safe next steps. The AI assistant also receives Guide context so it can answer questions about how A.U.R.A works.

### Settings

Contains:

- Environment
- Appearance
- AI Agent
- Proxy
- API Keys
- Storage

## Recon Modes

### Single Domain

Use for a controlled run against one authorized domain.

### Domain List

Use when the program gives multiple explicit in-scope domains or when you want to rerun only a known subset.

### Full Recon

Full recon is the broad workflow. It can include:

1. seed normalization
2. RDAP/WHOIS bootstrap
3. alternate TLD review lead generation
4. provider/API discovery
5. certificate transparency discovery
6. passive subdomain discovery
7. optional DNS bruteforce/permutation
8. DNS validation
9. archived URL mining
10. HTTP probing and technology detection
11. optional service enrichment
12. screenshot capture
13. technology aggregation
14. candidate asset correlation
15. delta comparison against previous run
16. AI-assisted triage and next-step suggestions

## Recon Phases

### 1. Target Normalization

A.U.R.A normalizes target input before scanning:

- domains are lowercased
- wildcard scope such as `*.example.com` is reduced to usable root seeds where appropriate
- URLs are parsed into host/domain components
- out-of-scope entries are kept as blockers
- duplicate seeds are compacted

### 2. Scope and Safety Gate

The UI requires explicit authorization before active enumeration. Passive bootstrap can run without launching active probes, but WSL/Kali tools and active provider workflows should be used only inside authorized scope.

Candidate leads from alternate TLDs, WHOIS, RDAP, code search, or correlation are not automatically scanned. They must be reviewed and added to authorized scope first.

### 3. WHOIS/RDAP Bootstrap

A.U.R.A can inspect public registration and RDAP-style data to find:

- organization names
- registrar/account hints
- abuse/contact email domains
- nameserver domains
- associated RDAP domains
- recurring registration patterns
- useful Reverse WHOIS terms

If RDAP/WHOIS does not produce useful organization terms, A.U.R.A falls back to brand-like terms derived from the root domains.

### 4. Alternate TLD Review Leads

A.U.R.A can generate likely alternate TLDs for the same registrable label. These are saved as review leads, not scanned automatically. Example: a target using `example.com` may produce candidate review items such as same-label domains on other TLDs.

### 5. Passive Sources

Passive sources collect existing public evidence without directly probing the target infrastructure. Current passive sources include public endpoints and API-backed providers.

### 6. Provider/API Enrichment

Optional providers increase coverage for certificate, DNS, host, URL, code, and organization evidence. Provider keys are tested and status-tracked from `Settings > API Keys`.

### 7. WSL/Kali Tool Execution

Selected tools run locally through the configured WSL distro or Linux runtime. A.U.R.A stores raw stdout and stderr artifacts before parsing.

### 8. DNS Validation

Discovered names can be validated with DNS tools. This separates stale passive observations from currently resolvable assets.

### 9. URL Mining

`gau` and archive sources are used to collect historical URLs and parameters. Parsed URL observations exclude static file extensions by default while preserving raw artifacts.

Default excluded parsed URL path extensions:

```text
jpg, jpeg, gif, css, tif, tiff, png, ttf, woff, woff2, ico, pdf, svg, txt
```

A URL such as `/download?file=report.pdf` is kept because the extension is in a parameter, not the path.

### 10. HTTP Probing

`httpx` checks live HTTP services, status codes, titles, redirects, web servers, and technology hints.

A.U.R.A supports port presets:

- **Small**: `80,443,8080,8443`
- **Medium**: `80,443,8009,8080,8081,8090,8180,8443,27000,27001,5000,5001,9001,81,9443,25,23`
- **Large**: extended common service surface including HTTP, admin, mail, observability, app, and database-adjacent ports
- **Custom**: operator-provided comma/space/newline-separated ports

Invalid ports and port `0` are ignored.

### 11. Nmap Service Enrichment

The engine supports an explicit nmap enrichment step using the same selected port model. This should be treated as an active follow-up step and should only run when authorized. It is intended for focused service-version evidence, not broad uncontrolled scanning.

### 12. Technology Enrichment

A.U.R.A aggregates technology observations from:

- `httpx` tech detection
- headers
- optional provider metadata
- optional local tools such as retire.js, WPScan, or CMSeeK when available
- future artifact parsers

Technology evidence is useful for prioritization, clustering, and targeted review. It is not ownership proof by itself.

### 13. Screenshots and Visual Triage

Screenshot tools capture visual evidence for live HTTP services. Default tool:

- `gowitness`

Optional tools:

- `aquatone`
- `EyeWitness`

Screenshot records are aligned across Projects and Results views so counts and previews refer to the same underlying screenshot payload.

### 14. Result Normalization

A.U.R.A normalizes and stores:

- domains and root domain relationship
- sources
- URL paths and query parameters
- HTTP status, title, server, technology, final URL, and content length
- screenshot run metadata
- tool execution records
- provider lead evidence
- candidate scores

### 15. Delta Comparison

Each rescan can be compared with the previous run for the same target. Delta review highlights:

- new domains
- removed domains
- new URLs
- removed URLs
- new HTTP services
- removed HTTP services
- stable observations

### 16. AI-Assisted Triage

The AI assistant receives run context, Guide context, and selected conversation context. It can:

- explain what each source/tool does
- summarize current run status
- explain warnings and failed tools
- recommend a safe next step
- interpret `Not run` correlation states
- explain why a candidate lead is weak or strong
- suggest which provider/source would fill an evidence gap
- draft focused follow-up plans

The AI should not invent target facts, validate credentials, bypass scope, or run destructive workflows.

## Passive Sources and API Providers

### crt.sh

Purpose: Certificate Transparency discovery.

Collects:

- DNS names from public TLS certificates
- SAN overlap evidence
- certificate timing and issuer clues

Feeds:

- domain inventory
- certificate correlation
- candidate evidence

### Wayback CDX

Purpose: archive URL discovery.

Collects:

- historical URLs
- paths
- parameters
- redirects
- linked hosts

Feeds:

- URL inventory
- parameter inventory
- JavaScript references
- Wayback/Common Crawl correlation

### RapidDNS

Purpose: public DNS/subdomain lookup.

Collects:

- subdomain records from public RapidDNS results

Feeds:

- domain inventory
- DNS validation

### Rapid7 FDNS

Purpose: large passive DNS dataset lookup.

Collects:

- forward DNS records from Rapid7 Open Data when available/configured

Feeds:

- domain inventory
- passive DNS review
- ASN/IP correlation

### Cert Spotter

Purpose: Certificate Transparency API enrichment.

Collects:

- certificate issuances
- DNS names for selected root domains

Feeds:

- certificate correlation
- domain inventory

### SecurityTrails

Purpose: DNS, subdomain, and WHOIS-style enrichment.

Collects:

- subdomains
- DNS metadata
- historical DNS evidence when available

Feeds:

- nameserver correlation
- MX/SPF/DMARC review
- passive DNS review
- domain inventory

### Shodan

Purpose: host and internet exposure intelligence.

Collects:

- DNS/domain data
- host/service metadata where account permissions allow
- possible favicon/service pivots

Feeds:

- HTTP fingerprint
- favicon hash review
- ASN/IP/passive DNS
- service triage

### VirusTotal

Purpose: domain intelligence and subdomain enumeration.

Collects:

- subdomains
- domain metadata
- public reputation-style context

Feeds:

- domain inventory
- passive DNS
- certificate/domain overlap

### Censys

Purpose: certificate and internet host intelligence.

Collects:

- certificate names
- host/service metadata depending on account permissions

Feeds:

- certificate correlation
- favicon hash review
- HTTP fingerprint
- ASN/IP evidence

### BinaryEdge

Purpose: internet scan and DNS intelligence.

Collects:

- known subdomains
- service-related observations where available

Feeds:

- domain inventory
- ASN/IP/passive DNS
- service review

### urlscan.io

Purpose: observed URL and page relationship intelligence.

Collects:

- scanned URLs
- page links
- domains
- scripts
- screenshot metadata
- third-party references

Feeds:

- JavaScript references
- analytics/pixel IDs
- CSP/header intelligence
- archive/crawl correlation

### Hunter.io

Purpose: email and public source attribution.

Collects:

- email patterns
- source pages
- public references for a domain

Feeds:

- WHOIS/RDAP overlap
- contact email pattern review
- organization evidence
- brand/string matching

### PassiveTotal

Purpose: passive DNS and enrichment.

Collects:

- subdomains
- passive DNS
- enrichment records

Feeds:

- ASN/IP/passive DNS
- nameserver correlation
- domain inventory

### ZoomEye

Purpose: web and host asset search.

Collects:

- web search results
- host evidence from `api.zoomeye.ai`

Feeds:

- HTTP fingerprint
- technology similarity
- favicon or service review

### Spyse

Purpose: domain intelligence.

Collects:

- subdomain and DNS intelligence when the provider is available

Feeds:

- domain inventory
- DNS correlation
- passive DNS

### Intelligence X

Purpose: public mentions, domain references, and phonebook-style search.

Collects:

- mentions
- URLs
- emails
- references depending on query and plan

Feeds:

- brand/string matching
- source/code references
- URL inventory

### WhoisXMLAPI

Purpose: Reverse WHOIS and DRS-style provider discovery.

Collects:

- domains related to organization terms
- registrant/WHOIS-style overlap when available

Feeds:

- WHOIS/RDAP overlap
- brand/string review
- candidate lead generation

### WhoisFreaks

Purpose: historical WHOIS enrichment.

Collects:

- historical registration evidence when available
- organization/contact changes
- registrar and date patterns

Feeds:

- WHOIS/RDAP overlap
- date-pattern correlation
- ownership review

### BuiltWith

Purpose: technology intelligence.

Collects:

- observed technologies
- analytics and platform signals when available

Feeds:

- technology stack similarity
- analytics/pixel IDs
- framework/platform review

### OpenRouter

Purpose: AI model provider.

Collects:

- no recon data by itself

Feeds:

- AI chat and assisted analysis when configured

## WSL/Kali Tools

### subfinder

Purpose: passive subdomain discovery.

Collects:

- subdomains from supported passive sources

Feeds:

- domain inventory
- dnsx validation
- httpx probing

### amass passive

Purpose: broader passive asset enumeration.

Collects:

- passive DNS/source-derived subdomains

Feeds:

- domain inventory
- DNS validation

### dnsx

Purpose: DNS record validation.

Collects:

- A records
- AAAA records
- CNAME records

Feeds:

- resolvable domain inventory
- HTTP probing
- DNS evidence

### puredns

Purpose: high-volume DNS resolution.

Collects:

- resolved names from candidate lists

Feeds:

- validated domain inventory
- HTTP probing

### shuffle-dns

Purpose: wordlist-based DNS discovery.

Collects:

- guessed subdomains from selected wordlists

Feeds:

- domain inventory
- dnsx/puredns validation

Use only when authorized and when rate limits are acceptable.

### gau

Purpose: archived URL collection.

Collects:

- historical URLs
- paths
- query parameters

Feeds:

- URL inventory
- parameter inventory
- JavaScript reference discovery
- archive correlation

### httpx

Purpose: HTTP probing and technology detection.

Collects:

- live HTTP URLs
- status codes
- titles
- redirects
- web server headers
- technology hints
- selected port coverage

Feeds:

- HTTP services
- technology stack aggregation
- screenshot targets
- HTTP fingerprint correlation

### nmap

Purpose: explicit service enrichment on selected ports.

Collects:

- open ports
- service/version evidence

Feeds:

- service review
- follow-up planning
- raw nmap artifacts

### gowitness

Purpose: visual triage.

Collects:

- screenshots
- local reports/databases

Feeds:

- screenshot view
- portal/admin/login review
- visual clustering

### aquatone

Purpose: alternative visual triage.

Collects:

- screenshots
- HTML report

Feeds:

- screenshot review
- visual evidence

### EyeWitness

Purpose: alternative website screenshot/reporting.

Collects:

- screenshots
- report output

Feeds:

- screenshot review
- visual evidence

### retire.js

Purpose: JavaScript dependency/technology review.

Collects:

- known JavaScript library/version evidence when configured

Feeds:

- technology enrichment
- outdated library review

### WPScan

Purpose: WordPress-specific inventory when WordPress is already detected.

Collects:

- public WordPress metadata and plugin/theme evidence depending on configuration

Feeds:

- technology enrichment
- WordPress follow-up planning

No credential checks should be automated.

### CMSeeK

Purpose: CMS detection/enrichment.

Collects:

- CMS hints
- framework/platform clues

Feeds:

- technology enrichment
- follow-up planning

## Candidate Correlation Techniques

Correlation techniques help decide whether a candidate asset may belong to the same organization or program. They produce evidence and review scores. They do not automatically authorize scanning.

A `Not run` state means A.U.R.A has not collected enough candidate data or enough evidence for that specific technique yet. It is a state indicator, not automatically an error.

### WHOIS/RDAP Overlap

Looks for:

- same organization
- same registrant
- same abuse/contact email
- same registrar account clues
- same nameserver ownership
- recurring date patterns
- associated RDAP domains

Sources:

- RDAP bootstrap
- WhoisXMLAPI
- WhoisFreaks
- Hunter.io contact clues
- SecurityTrails-style metadata

Best use:

- strong ownership signal when organization/contact evidence is specific
- weaker when data is privacy-protected or registrar-only

### Nameserver Correlation

Looks for:

- same custom nameserver
- same vanity NS domain
- same DNS hosting cluster
- recurring NS naming pattern

Sources:

- SecurityTrails
- PassiveTotal
- Rapid7 FDNS
- DNS validation
- RDAP associated domains

Best use:

- strong when nameservers are custom or organization-specific
- weak when only common DNS providers match

### MX/SPF/DMARC Correlation

Looks for:

- same MX provider
- same corporate mail domain
- same SPF includes
- same DMARC policy
- recurring email infrastructure

Sources:

- DNS TXT/MX enrichment
- SecurityTrails
- PassiveTotal
- future DNS record parsers

Best use:

- ownership/context signal for corporate domains
- weak when common SaaS mail providers are the only match

### Certificate Correlation

Looks for:

- shared SANs
- certificate organization fields
- issuer/timing patterns
- CT log evidence
- repeated certificate naming conventions

Sources:

- crt.sh
- Cert Spotter
- Censys
- VirusTotal

Best use:

- strong when SANs or certificate org data directly link candidates
- useful for discovering forgotten subdomains

### Analytics and Pixel IDs

Looks for shared tracking IDs such as:

- Google Analytics
- Google Tag Manager
- Meta Pixel
- Hotjar
- Segment
- Plausible
- similar tracking identifiers

Sources:

- urlscan.io
- JavaScript artifacts
- page/body/header parsers
- BuiltWith-style technology data

Best use:

- useful brand/ownership hint
- weaker when marketing agencies, templates, or shared platforms reuse IDs

### Favicon Hash

Looks for:

- same favicon hash
- Shodan/Censys favicon pivot evidence
- unique application icons

Sources:

- Shodan
- Censys
- httpx/favicon follow-up
- screenshot/HTTP artifact parsers

Best use:

- strong for unique internal portals
- weak for common frameworks or default product icons

### HTTP Fingerprint

Looks for:

- same title
- same headers
- same redirect chain
- same body hash
- same response size/pattern
- response similarity

Sources:

- httpx
- urlscan.io
- screenshots
- future body-hash parser

Best use:

- clustering similar portals
- spotting legacy shared applications
- prioritizing visual triage

### Technology Stack Similarity

Looks for:

- same CMS
- same CDN
- same framework
- same WAF
- same cookie names
- same version patterns
- same web server hints

Sources:

- httpx tech detect
- headers
- retire.js
- WPScan
- CMSeeK
- BuiltWith-style provider data

Best use:

- prioritization and clustering
- not ownership proof by itself

### Brand and String Matching

Looks for:

- brand names
- product names
- acquisition names
- legacy business names
- campaign names
- recurring naming overlap

Sources:

- target root domains
- WHOIS/RDAP terms
- Wayback URLs
- code/source references
- alternate TLD review leads

Best use:

- weak to medium signal
- combine with another evidence class before treating as likely owned

### ASN/IP/Passive DNS

Looks for:

- historical IP overlap
- origin IPs
- reverse IP evidence
- shared certificate/IP evidence
- netblock evidence
- passive DNS history

Sources:

- PassiveTotal
- SecurityTrails
- Shodan
- Censys
- Rapid7 FDNS
- dnsx

Best use:

- strong when infrastructure is owned or historically stable
- weak on shared hosting and CDNs

### CSP/Header Intelligence

Looks for references in headers such as:

- `connect-src`
- `script-src`
- `img-src`
- `frame-src`
- `report-uri`
- `report-to`
- security header references

Sources:

- HTTP headers
- urlscan.io
- future header artifact parsers

Best use:

- finding APIs
- asset hosts
- reporting endpoints
- third-party service relationships

### JavaScript References

Looks for:

- domains
- endpoints
- API hosts
- workspace IDs
- account IDs
- config objects
- application routes

Sources:

- gau
- Wayback
- urlscan.io
- future getJS/linkJS workflows
- stored JavaScript artifacts

Best use:

- high-value for hidden endpoints and app topology
- never validate secrets or credentials automatically

### App Association Files

Looks for:

- `assetlinks.json`
- `apple-app-site-association`
- Android app IDs
- iOS app IDs
- mobile bundle identifiers

Sources:

- well-known path probing
- mobile association parsers

Best use:

- mobile/web asset ownership mapping
- app-domain relationships

### GitHub and Code Search

Looks for:

- domain references in repositories
- organization metadata
- files and API collections
- public source references
- infrastructure names

Sources:

- GitHub API key
- local repository artifact review
- public code search results

Best use:

- redacted review items
- source attribution
- candidate evidence

Never copy, validate, replay, or use discovered secrets.

### Wayback and Common Crawl

Looks for:

- historical cross-domain links
- redirects
- legacy assets
- parameters
- old app surfaces
- forgotten hosts

Sources:

- Wayback CDX
- gau
- future Common Crawl-style source

Best use:

- old endpoints
- forgotten redirects
- legacy assets
- pre-migration infrastructure

## Wordlist Categories

### domains

Raw domain/subdomain names for DNS tools and generic discovery. Use this when you want a straightforward list of names gathered from stored observations.

### smart-domains

Target-aware domain words derived from observed assets, brand terms, technologies, naming patterns, and stored recon evidence. Use this for target-specific permutation and focused discovery planning.

### params

Parameter names extracted from URLs and archives. Useful for parameter inventory and later manual testing plans.

### paths

URL paths or path words extracted from stored URLs and artifacts. Useful for content discovery planning.

### technologies

Technology names observed in HTTP probing, headers, providers, or enrichment tools. Useful for prioritization and follow-up planning.

### payloads

Reserved category for operator-managed payload lists. A.U.R.A should not ship destructive payload automation as a default recon workflow.

## Target-Specific vs Global Wordlists

Target-specific wordlists should use the active target and only its observations. They are best for focused reruns, permutations, and program-specific naming patterns.

Global DB-derived wordlists use records across all targets. They can be useful for reusable naming patterns, but they must be used carefully because they may mix unrelated programs.

The intended UX is:

- **current target only** for precise, scope-aware wordlists
- **all targets** only when the operator intentionally wants a global list

## API Key Management

The API key table shows:

- provider
- label
- masked key preview
- status
- usage
- actions

Actions include:

- test one key
- disable/enable where supported
- delete
- test all keys
- import/export keys

A.U.R.A stores API keys locally. Provider response errors are surfaced through preflight messages so a failed key is visible instead of silently ignored.

## Proxy Support

`Settings > Proxy` supports explicit upstream proxy configuration for authorized interception or lab egress. Supported proxy URL schemes include:

- `http`
- `https`
- `socks4`
- `socks5`

Proxy settings are for controlled routing, not bypassing program limits or unauthorized restrictions.

## AI Agent

The AI assistant is integrated into the UI and receives:

- current target context
- current run context
- selected conversation context
- in-product Guide context
- run milestones
- delta summaries
- technology summaries
- screenshot progress
- tool warning/retry information

The AI can help with:

- explaining A.U.R.A features
- explaining sources and tools
- understanding `Not run` correlation states
- interpreting run warnings
- summarizing findings
- suggesting safe next steps
- identifying missing evidence classes
- drafting focused follow-up plans
- triaging tool failures

The AI should not:

- invent target-specific facts
- validate credentials
- replay secrets
- suggest out-of-scope scanning
- run destructive actions
- turn weak leads into authorized scope without user confirmation

## Run Controls and Reliability

Runs can be paused, resumed, or cancelled. Control is cooperative: a tool invocation already running may finish before the run stops.

A.U.R.A records:

- run status
- active phase
- events
- heartbeats
- tool command display
- stdout path
- stderr path
- exit code
- error message
- recovery attempts

Some transient tool/network failures can trigger non-blocking retry logic. If a tool still fails, A.U.R.A keeps partial artifacts and continues with remaining non-blocking steps when possible.

## Data Storage

Project data is stored locally:

```text
public/web/              Web dashboard HTML/CSS/JS
scripts/                 Web server entrypoint
src/core/                JSON IO and validation helpers
src/db/                  SQLite store
src/recon/               Recon engine, parsers, tool runners, providers, wordlists
src/recon/providers/     Provider-specific adapters
src/web/                 Local HTTP server and API routes
tests/                   Node test suite
data/                    Local DB and generated artifacts, ignored by Git
targets/                 Local target configs and per-target state
```

Important local data includes:

- SQLite database
- recon run artifacts
- generated wordlists
- screenshot outputs
- target configs
- exported results

## Exports

A.U.R.A can export loaded run data as:

- JSON
- CSV
- Markdown
- filtered Results Explorer JSON
- filtered Results Explorer CSV

Exports are intended for reporting, offline review, and handoff to manual tools.

## Safe Handling of One-Liners and Manual Recon Tricks

A.U.R.A can absorb useful manual recon patterns, but they should be converted into safe modules or review workflows rather than copied as raw shell pipelines.

Safe patterns include:

- JavaScript URL inventory
- link extraction from saved JavaScript artifacts
- query parameter grouping
- small well-known path inventory under authorization
- technology-specific follow-up plans
- local artifact review with redacted output
- wordlist generation from observed data

Excluded from default automation:

- credential validation or replay
- destructive remote actions
- raw secret storage in logs/source/docs
- unconfirmed active testing
- out-of-band payload injection without a separate confirmed workflow
- broad uncontrolled scanning outside authorized scope

## Testing

Run:

```powershell
npm test
```

The test suite includes coverage for:

- recon engine behavior
- provider API catalog/preflight assumptions
- parser behavior
- static URL extension filtering
- httpx port presets
- nmap tool specification parsing
- wordlist and store behavior where implemented

## Recommended Operator Flow

For a new target:

1. Check environment.
2. Add optional provider keys.
3. Create the target and scope.
4. Confirm authorization.
5. Start with passive defaults and medium httpx ports.
6. Review delta, services, screenshots, technologies, and AI Log.
7. Use Search for pivots.
8. Generate a target-specific smart-domain wordlist if naming patterns are useful.
9. Run focused follow-up instead of repeating full broad recon.
10. Add candidate assets to scope only after evidence review and authorization confirmation.

## Safety Model

A.U.R.A is for authorized scopes only. Keep scope definitions current, keep out-of-scope values explicit, and treat uncertain assets as review leads.

The project should help an operator understand and organize recon evidence. It should not turn ambiguity into authorization, bypass program rules, or automate exploit behavior.
