# A.U.R.A Recon Methodology

This document defines the initial bug bounty web recon methodology for A.U.R.A.
The product is local-first and modular: every provider, CLI tool, parser, and
recon phase should be replaceable through configuration or a registry.

## Goals

- Support authorized bug bounty web recon as the MVP.
- Preserve raw tool/provider output as artifacts.
- Normalize useful facts into the database.
- Let users choose tools, providers, arguments, and recon profiles from the UI.
- Ensure every major capability is usable from the Web UI.
- Ensure the AI chat agent can assist every major workflow and phase.
- Keep the architecture ready for future local workers, WSL workers, native Linux
  workers, and remote workers.
- Avoid custom scanners when mature tools already provide structured output.
- Help users find less-tested application surfaces, not only the largest or most
  obvious hosts.

## Non-Goals For MVP

- Exploit automation.
- IP rotation or evasion of rate limits, bans, or provider controls.
- Autonomous vulnerability testing without explicit user control.
- Automated proof-of-concept generation.
- Report drafting as a primary workflow.

## Recon Profiles

Every profile should be backed by explicit limits, queue priorities, timeout
budgets, and stop conditions. Large scopes should degrade gracefully instead of
running every phase at full intensity.

### Passive

Uses passive sources and provider APIs. This profile should avoid direct probing
of target infrastructure except for low-risk metadata lookups.

Typical phases:

- Scope parsing.
- Seed normalization.
- Certificate transparency.
- Passive DNS.
- Archive URL discovery.
- Provider enrichment.
- GitHub/code search metadata.
- Search engine dorking metadata.
- Domain intelligence.

### Standard

Adds validation and lightweight active discovery.

Typical phases:

- Everything in Passive.
- DNS resolution.
- HTTP probing.
- Technology detection.
- URL and parameter normalization.
- Screenshot capture for live web services.

### Full

Adds controlled active enumeration and deeper web discovery.

Typical phases:

- Everything in Standard.
- Subdomain brute force.
- Vhost discovery.
- Crawling.
- Content discovery.
- Parameter discovery.
- API route discovery.
- Cloud asset enumeration.
- ASN/netblock enrichment when in scope.

## Scope Model

A.U.R.A should support:

- Exact domains: `example.com`.
- Wildcards: `*.example.com`.
- URLs: `https://app.example.com/login`.
- Explicit out-of-scope domains.
- Explicit out-of-scope wildcards.
- Structured imports from bug bounty platform scope pages or exports.
- CIDR and ASN scope later, after the web-domain MVP is stable.

Every discovered item should receive a scope evaluation:

- `in_scope`
- `out_of_scope`
- `unknown`

Unknown items must not be promoted automatically to target assets.

## MVP Boundary

The full methodology is intentionally broader than the first implementation.
The first production-quality MVP should focus on doing the early pipeline well:

- Phase 0: Target and scope setup.
- Phase 1: Seed normalization.
- Phase 2: Passive subdomain discovery.
- Phase 2a: Search engine dorking.
- Phase 2b: GitHub and code search analysis.
- Phase 3: Domain intelligence and provider enrichment.
- Phase 4: Active subdomain enumeration with conservative defaults.
- Phase 5: DNS resolution and record collection.
- Phase 5a: CDN origin discovery.
- Phase 6: HTTP probing.
- Phase 6b: Well-known file discovery.
- Phase 7: Archive URL discovery.
- Phase 8: Crawling and URL discovery.
- Phase 17: Asset promotion for the collected data.

Cloud asset enumeration, ASN mapping, deeper content discovery, API route
bruteforce, authenticated crawling, and template-based checks should be added
iteratively after the MVP data model and job system are stable.

MVP extended candidates:

- Wayback gap analysis.
- AXFR checks.
- Debug and health endpoint discovery.
- HTTP/2 and HTTP/3 metadata capture.
- CSP intelligence extraction.
- Reverse IP correlation.
- Supply chain script tracking.
- WAF/security-control fingerprinting.
- Export and interoperability.
- False-positive management workflow.
- Notification webhooks.

V2 candidates:

- Correlation graph engine.
- Real-time CT log monitoring.
- Conditional recon playbooks.
- Third-party SaaS surface mapping.
- OpenAPI reconstruction.
- AI-assisted priority scoring.
- Historical memory and reasoning retrieval.
- Authentication surface mapping.
- Network request capture and headless browser pool.
- Scope change monitoring.
- Raw artifact regex search.
- Authorization/legal documentation store.

## Data Flow

Every tool and provider follows the same shape:

```text
input
  -> job
  -> raw artifact
  -> parser
  -> observations
  -> normalized DB rows
  -> optional promoted assets
```

Raw output must be kept even when parsing fails.

User-facing reads should automatically compact duplicate normalized
observations for UI tables, topology, exports, search summaries, and generated
wordlists. Compaction must aggregate source attribution and evidence links
instead of deleting raw artifacts or per-source observations.

## UI-First Workflow

Every major A.U.R.A capability should be available from the Web UI. CLI scripts
may exist for automation and debugging, but they should not be the only way to
use a feature.

The Web UI should cover:

- Target creation and scope import/review.
- OpenCode bootstrap and model/provider configuration.
- Tool registry browsing, custom tool manifests, install checks, and version
  checks.
- Provider/API key management with masked secrets.
- Recon profile selection and per-phase configuration.
- Rate limits, timeouts, concurrency, and stop conditions.
- Run creation, pause/cancel/resume, and live job/event monitoring.
- Artifact browsing and raw artifact search.
- Observation, asset, review item, and graph/correlation views.
- Playbook authoring, test runs, and trigger audit.
- False-positive dismissal and suppression rules.
- Exports and interoperability outputs.
- Memory snapshots, reasoning notes, and run comparisons.
- Notification rules and delivery status.

The AI chat agent should be present as a contextual assistant across these
workflows. It should be able to explain the current view, suggest next steps,
prepare configs, draft manifests or playbooks, summarize data, and invoke
approved actions through A.U.R.A with the appropriate autonomy level and user
confirmation.

## Tool Registry

Tools, providers, parsers, and phases must be declared through registries rather
than hardcoded orchestration.

A tool manifest should define:

```yaml
tool_id: subfinder
type: cli
phase: passive_subdomain_discovery
binary: subfinder
version_check:
  command: subfinder
  args: ["-version"]
input_type: domain_list
output_format: jsonl
output_path: stdout
rate_limit_profile: default_passive
parser: subfinder_jsonl
tags: [passive, subdomain]
install:
  method: go_install
  source: github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
env_vars:
  - SUBFINDER_API_KEYS
safety:
  requires_authorization: false
  active_network: false
  default_profile: passive
```

Manifest fields:

- `tool_id`: stable unique ID.
- `type`: `cli`, `provider`, `internal`, or `agent_action`.
- `phase`: default methodology phase.
- `binary`: executable name for CLI tools.
- `version_check`: command used for health checks.
- `input_type`: expected input artifact or observation type.
- `output_format`: `json`, `jsonl`, `text`, `csv`, `xml`, `har`, or custom.
- `output_path`: `stdout`, `stderr`, file path, directory, or artifact glob.
- `rate_limit_profile`: default rate/concurrency profile.
- `parser`: parser registry ID.
- `tags`: searchable labels.
- `install`: install strategy and source.
- `env_vars`: expected environment variables or secret names.
- `safety`: authorization, activity, and profile metadata.

Parser registration should be separate from tool registration and should map:

- Tool ID.
- Output format.
- Parser ID.
- Parser version.
- Observation types produced.

Users should be able to add custom tool manifests from the UI or from a local
`data/tool-registry/custom/` directory. Invalid manifests should be rejected with
clear validation errors.

## Worker Protocol

Recon execution should use a worker protocol that works for local, WSL, native
Linux, and future remote workers.

Job lifecycle:

```text
QUEUED -> DISPATCHED -> RUNNING -> SUCCEEDED
QUEUED -> DISPATCHED -> RUNNING -> FAILED
QUEUED -> DISPATCHED -> RUNNING -> TIMED_OUT
QUEUED/DISPATCHED/RUNNING -> CANCELLED
FAILED/TIMED_OUT -> QUEUED
```

Job payload should include:

- Job ID.
- Run ID.
- Target name.
- Phase.
- Tool ID.
- Input artifacts or observation references.
- Resolved arguments.
- Environment variables or secret references.
- Rate limit profile.
- Timeout.
- Max attempts.
- Output artifact policy.
- Scope constraints.

Worker capability declaration should include:

- Worker ID.
- OS and execution mode, such as WSL or native Linux.
- Installed tools and versions.
- Supported phases.
- Available CPU, memory, disk, and browser capacity.
- Network mode.
- Last heartbeat.

Worker reports should include:

- Status.
- Exit code.
- Started and finished timestamps.
- Duration.
- stdout artifact path.
- stderr artifact path.
- Additional artifact paths.
- Parser status.
- Error message.
- Heartbeat timestamps for long-running jobs.

The first implementation can use an SQLite-backed queue and local worker. The
protocol should remain compatible with Redis, SQS, Postgres queues, or remote
worker polling later.

## Export And Interoperability

A.U.R.A should make collected data easy to move into manual testing tools.

Exports should support:

- Burp Suite target/scope lists and sitemap-friendly URL lists.
- Caido-compatible target and URL lists.
- Nuclei target lists filtered by scope, confidence, technology, or tags.
- `ffuf` wordlists generated from paths, parameters, extensions, and technologies.
- CSV and JSON exports for observations, assets, review items, and run deltas.
- SARIF for findings and review items.
- Markdown/HTML run snapshots.
- Postman collections or partial OpenAPI specs from reconstructed API data.

Every export should support filters:

- Target.
- Run or run range.
- Scope status.
- Confidence.
- Observation type.
- Tags.
- Source/provider.
- Time window.

Every export should be recorded as an event with the selected filters, output
path, row counts, and timestamp.

## False Positive And Suppression Management

Dismissals and suppressions are first-class workflow data.

Dismiss reasons:

- `false_positive`
- `out_of_scope_confirmed`
- `known_behavior`
- `wont_fix`
- `duplicate`
- `not_interesting`

Dismissal records should include:

- Observation/review item ID.
- Reason.
- Optional note.
- Timestamp.
- User or agent action source.
- Evidence snapshot.

Suppression rules should allow users to reduce recurring noise, for example:

- Do not show `/robots.txt` status 200 as a review item for this target.
- Mark repeated known provider findings as likely known.
- Suppress a noisy playbook rule for a target.

Future matches should be tagged as `likely_known` rather than hidden entirely
unless the user explicitly chooses hard suppression.

Playbooks and priority scoring should track false-positive rate:

- Trigger count.
- Dismiss count.
- Accepted/promoted count.
- Resulting priority adjustment.

## Job Control, Rate Limits, And Throttling

Rate limiting is a first-class part of the methodology. Every provider and tool
definition should declare a default rate limit profile.

Job metadata should include:

- `rate_limit_profile`
- `priority`
- `timeout_ms`
- `max_attempts`
- `backoff_strategy`
- `concurrency_group`
- `stop_conditions`

Rate limit profiles should define:

- Max concurrent jobs.
- Max requests or invocations per time window.
- Provider quota where applicable.
- Exponential backoff behavior.
- Cooldown behavior after 429, 403, timeout spikes, or provider-specific errors.

The UI should expose safe defaults and let advanced users tune them per target,
provider, phase, and tool.

Runs must support user control from the Web UI:

- Pause a running or queued run.
- Resume a paused run.
- Cancel a run.
- Record every control action as an event.

Pause and cancel are cooperative for CLI tools. Workers should honor them
between provider calls, phases, and tool invocations. A tool process that is
already running may finish before the worker stops the next step.

Long-running tool invocations should emit heartbeat events so the UI and AI
assistant can explain what is currently running and when it last produced
activity.

Collected run data should be exportable in portable formats:

- JSON for full-fidelity machine-readable snapshots.
- CSV for spreadsheet triage.
- Markdown for quick human-readable run summaries.

## Deduplication And Canonicalization

Deduplication must happen before observations become stable normalized rows.

Canonicalization should cover:

- Domains: lowercase, trim wildcards, remove trailing dots, IDNA handling.
- URLs: normalize scheme/host casing, default ports, fragments, trailing slash
  policy, duplicate slashes, and percent-encoding where safe.
- Query parameters: sort parameters, remove known tracking parameters, preserve
  raw query in artifacts.
- Paths: normalize repeated slashes and obvious dot segments.
- Technologies: normalize aliases and versions.
- DNS records: canonical host/value pairs with record type.

The raw artifact remains unchanged. Canonical rows should keep links back to all
source observations so the user can inspect conflicting evidence.

## Confidence Scoring

Every observation should have a confidence value:

- `high`
- `medium`
- `low`
- `unknown`

Suggested defaults:

- `high`: DNS resolution, certificate SANs, direct tool output from scoped
  hosts, provider records with strong evidence.
- `medium`: passive DNS, Shodan/Censys observations, archived URLs, repeated
  observations across independent sources.
- `low`: search engine snippets, brand-adjacent domain suggestions, acquisition
  candidates, single-source code references without direct validation.
- `unknown`: imported or custom-tool observations without a parser confidence
  rule.

Confidence should be source-aware and may increase when independent sources
agree. Confidence is not scope authorization.

## Correlation Engine

The correlation engine turns observations into a graph of typed relationships.
It is the reasoning layer that connects independent facts into discovery paths.

Example relationships:

- Domain -> certificate -> SAN -> domain.
- IP address -> Shodan/Censys host data -> observed hostname.
- Favicon hash -> Shodan result -> origin candidate.
- ASN -> netblock -> IP address.
- Certificate organization -> certificate -> domain.
- Nameserver -> hosted domain candidate.
- MX/SPF provider -> SaaS provider.
- HTTP service -> third-party script -> SaaS provider.
- Tracking ID -> related website candidate.
- Pixel endpoint -> related website candidate.

Every edge should include:

- Source node.
- Target node.
- Edge type.
- Confidence.
- Source/provider.
- Evidence artifact.
- First seen and last seen timestamps.

MVP can model this in SQLite with edge tables and recursive CTE queries. Larger
deployments may later use a graph database or graph index.

Useful graph queries:

- Find domains related to an IP within two hops.
- Find origin candidates connected by favicon hash and certificate evidence.
- Find SaaS providers linked to a target by MX, SPF, CNAME, JavaScript, or
  cookies.
- Find websites related by analytics IDs, tag manager IDs, or tracking pixels.
- Find assets newly connected to the target since the last run.

## Conditional Recon Playbooks

Static phases should be complemented by conditional playbooks. A playbook rule
triggers when observations match a condition and then proposes or queues
follow-up actions.

Rule triggers may match:

- Observation type.
- Field values.
- Confidence.
- Scope status.
- Tags.
- Source/provider.
- Run delta status.
- Technology or service fingerprints.

Rule actions may:

- Promote an asset.
- Create a review item.
- Queue a phase or tool job.
- Notify the user.
- Add tags.
- Suggest a manual follow-up.

Rules should be editable from the UI, preferably as YAML and later with a visual
editor. Every trigger must be logged with the matched evidence.

Example playbook rules:

```yaml
name: wordpress_followup
trigger:
  observation_type: technology
  value: WordPress
actions:
  - suggest_phase: content_discovery
    wordlist: seclists/cms/wordpress
  - suggest_phase: template_checks
    nuclei_tags: [wordpress, cms]
  - review_item:
      message: "WordPress detected - consider CMS-specific review in Full profile"
```

```yaml
name: github_cname_takeover
trigger:
  observation_type: dns_record
  record_type: CNAME
  value_pattern: "*.github.io"
actions:
  - promote: takeover_candidate
    confidence: high
    evidence: "CNAME points to github.io"
  - notify: true
```

```yaml
name: api_401_followup
trigger:
  observation_type: http_service
  status_code: 401
  path_pattern: "/api/*"
actions:
  - suggest_phase: parameter_discovery
  - promote: app_surface
    tags: [api, gated]
```

## AI-Assisted Priority Scoring

A.U.R.A should eventually rank assets and review items instead of presenting all
observations equally.

Signals:

- Less-tested naming patterns such as `legacy`, `old`, `backup`, `dev`, `qa`,
  or non-standard ports.
- Recent appearance in run deltas.
- High-risk pattern matches on parameters.
- Technologies with known recent CVEs.
- Low visibility, such as single-source discoveries absent from archives.
- Origin, takeover, or deprecated endpoint candidates.
- Missing or weak security controls.

Outputs:

- Priority score.
- Human-readable rationale.
- Contributing signals.
- Confidence.

The AI may help explain ranking, but deterministic signals and evidence should
be stored so the score is auditable.

## Notifications And Alerting

Notifications are first-class for continuous monitoring.

Supported channels should eventually include:

- Local UI notifications.
- Webhooks.
- Slack.
- Discord.
- Custom HTTP endpoints.

Notification rules should filter by:

- Target.
- Scope status.
- Confidence.
- Observation type.
- New asset/change/takeover/origin candidate.
- Playbook trigger.

Delivery modes:

- Immediate.
- Daily digest.
- Per-run summary.

Every notification should be stored as a `notification_event` with delivery
status and linked evidence.

## Historical Memory And Reasoning Retrieval

A.U.R.A should maintain historical memory across targets, runs, observations,
artifacts, agent conversations, and user decisions.

The goal is not only to store data, but to let the system interpolate facts,
compare changes over time, reuse prior reasoning, and explain why a suggestion
was made.

Memory layers:

- Factual memory: normalized observations, assets, jobs, artifacts, run deltas,
  and correlation edges.
- Temporal memory: first seen, last seen, disappeared, changed, and reappeared
  facts across runs.
- Semantic memory: summaries of large artifacts, clusters, technologies,
  recurring patterns, and target-specific notes.
- Decision memory: user confirmations, dismissed findings, promoted assets,
  accepted/rejected suggestions, and playbook outcomes.
- Agent memory: AI conversations, reasoning summaries, prompts, selected models,
  tool suggestions, and action results.

Memory rules:

- Raw artifacts remain the source of truth.
- AI reasoning must link back to evidence, observations, artifacts, or queries.
- Important AI conclusions should be stored as `reasoning_note` records with
  timestamps, source context, model/provider, and confidence.
- Periodic `memory_snapshot` records can summarize a target's state for faster
  retrieval.
- Dismissed or false-positive items should remain queryable so the AI does not
  repeatedly resurface the same low-value suggestion.
- Secrets must be redacted from semantic and agent memory.
- Users should be able to delete or redact memory for a target.

Retrieval modes:

- Exact DB queries for facts.
- Graph traversal for relationships.
- Full-text search over artifacts, notes, and summaries.
- Optional embedding search over summaries and user-approved artifact excerpts.
- Cross-data saved search across normalized domains, URLs, HTTP services,
  technologies, titles, parameters, asset leads, findings, and future memory
  records. This should let users answer questions such as "show every scanned
  asset using Citrix, jQuery, or Joomla" when a new CVE or advisory appears.

The AI copilot should receive scoped memory context:

- Current target.
- Selected run or comparison window.
- Relevant observations and graph edges.
- Prior decisions and dismissed findings.
- Recent reasoning notes.
- Linked evidence IDs.

The AI should distinguish between:

- Stored fact.
- Inference from correlated evidence.
- Hypothesis requiring validation.
- User decision or preference.

Every AI-assisted interpolation should be explainable with cited evidence and
should not silently promote unknown-scope assets.

## Core Observation Types

- `domain`
- `dns_record`
- `ip_address`
- `http_service`
- `url`
- `path`
- `parameter`
- `javascript_file`
- `certificate`
- `cloud_asset`
- `asn`
- `netblock`
- `repository_reference`
- `code_reference`
- `search_result`
- `review_item`
- `takeover_candidate`
- `dependency`
- `template_finding`
- `domain_candidate`
- `origin_candidate`
- `mobile_app`
- `graphql_endpoint`
- `websocket_endpoint`
- `email_security_record`
- `well_known_resource`
- `pattern_match`
- `run_delta`
- `correlation_edge`
- `saas_provider`
- `security_control`
- `archived_gap`
- `third_party_script`
- `openapi_spec`
- `priority_score`
- `notification_event`
- `tracking_identifier`
- `reasoning_note`
- `memory_snapshot`
- `auth_surface`
- `authorization_record`
- `scope_delta`
- `artifact_search_result`
- `suppression_rule`

## Phase 0: Target And Scope Setup

Inputs:

- Program name.
- Program URL.
- In-scope domains, wildcards, URLs.
- Out-of-scope domains, wildcards, URLs.
- Bounty platform metadata, rewards, policy notes, and acquisition rules.
- HackerOne/Bugcrowd/Intigriti-style structured scope imports where available.
- Optional notes and authorization metadata.

Outputs:

- Normalized target config.
- Scope rules.
- Program metadata.
- Seed domains.
- Seed hosts.
- Seed URLs.
- Authorization records.

Notes:

- Scope setup should capture whether acquisitions, subsidiaries, mobile apps,
  marketing sites, support portals, and parent-company assets are included or
  excluded by policy.
- Platform imports should be treated as source artifacts. The user should review
  and confirm the normalized scope before running active phases.

Authorization records should store:

- Program URL and policy snapshot.
- Uploaded authorization files when applicable.
- Policy screenshot or archived copy when available.
- Run start timestamp and scope snapshot hash.
- SHA256 hashes for important artifacts.
- Notes about scope confirmations and exclusions.

## Phase 1: Seed Normalization

Normalize user input into canonical forms:

- Root domains.
- Hostnames.
- URLs.
- Wildcard rules.
- Out-of-scope rules.

No network calls should happen in this phase.

## Phase 2: Passive Subdomain Discovery

Default tools/providers:

- `subfinder`
- `amass` passive mode
- `crt.sh`
- GitHub subdomain search
- Search engine dorks
- Rapid7 Open Data / Project Sonar FDNS
- AlienVault OTX, Chaos, SecurityTrails, or similar providers when configured

Outputs:

- Candidate domains.
- Source attribution.
- Confidence.
- Raw artifacts.

Notes:

- Rapid7 Open Data datasets can be very large, so the adapter should support
  streaming, local caching, suffix filtering, and partial artifact indexing.
- GitHub/code search should use official APIs or user-provided tokens where
  available, with rate limits and clear attribution.
- Search engine dorking should prefer official/custom search APIs or manual
  user workflows. A.U.R.A should not rely on brittle scraping of search result
  pages.

## Phase 2a: Search Engine Dorking

Default tools/providers:

- Google Programmable Search Engine where configured.
- Bing Web Search API or equivalent provider where configured.
- Manual dork templates exported for browser use.
- `go-dork` or similar user-installed tools when configured.

Example query families:

- `site:*.example.com`
- `site:example.com ext:pdf OR ext:doc OR ext:xls`
- `site:example.com inurl:admin OR inurl:login`
- `site:example.com ext:env OR ext:yaml OR ext:ini`
- `site:example.com inurl:swagger OR inurl:openapi`
- `"example.com" "api_key"`
- `"example.com" "Authorization: Bearer"`

Outputs:

- Search result URLs.
- Titles and snippets when the provider allows storing them.
- Candidate domains.
- Candidate URLs.
- Interesting document references.
- Review items.

Rules:

- Dork templates must be editable from the UI.
- Queries must be rate-limited and provider-aware.
- Results should be scope-filtered before becoming follow-up jobs.
- Sensitive-looking snippets should become `review_item` observations and must
  not trigger automatic validation.

## Phase 2b: GitHub And Code Search Analysis

Default tools/providers:

- GitHub REST/GraphQL/code search APIs.
- `github-subdomains`
- `github-search`
- `GitDorker`
- `trufflehog` in passive/local repository mode where applicable.
- `gitleaks` in passive/local repository mode where applicable.

Use cases:

- Find subdomains in public code.
- Find URLs and API endpoints.
- Find Swagger/OpenAPI/Postman references.
- Find mobile app endpoints and backend hostnames.
- Find interesting paths, parameters, and feature flags.
- Flag possible secrets for manual review.

Outputs:

- Repository references.
- Code references.
- Domains.
- URLs.
- API routes.
- Parameters.
- JavaScript/package references.
- Review items for sensitive-looking matches.

Rules:

- Prefer official GitHub APIs and user-provided tokens.
- Store file path, repository, commit/blob reference, line number when available,
  and a short excerpt only when allowed.
- Do not clone or scan large repositories by default.
- Do not validate discovered credentials automatically in MVP.
- Secret scanners should run only against user-selected local clones or explicitly
  selected public repositories, with clear rate and size limits.

## Phase 2c: Mobile App Endpoint Extraction

Default tools:

- `apktool`
- `jadx`
- `apkleaks`
- `MobSF` where configured

Use cases:

- Extract API hosts and routes from Android APKs.
- Extract URLs, hostnames, feature flags, bundle identifiers, and deep links.
- Parse public mobile app metadata found through dorks, app association files,
  repositories, or user-provided binaries.

Outputs:

- Mobile app references.
- Domains.
- URLs.
- API routes.
- Bundle/package identifiers.
- Review items for sensitive-looking matches.

Rules:

- Mobile extraction is passive and should not require a device in MVP.
- User-provided APKs/IPAs and extracted files must be stored as artifacts or
  artifact references.
- Endpoint extraction output should feed JavaScript analysis, API route
  discovery, and asset promotion.
- Do not validate discovered credentials or tokens automatically.

## Phase 3: Domain Intelligence And Provider Enrichment

Providers:

- Shodan
- Censys
- Rapid7 Open Data
- Instant Domain Search
- RDAP/WHOIS providers
- Reverse WHOIS providers
- Trademark, privacy policy, and acquisition research sources

Use cases:

- Enrich known hosts and IPs.
- Suggest useful Reverse WHOIS terms from public RDAP/WHOIS evidence.
- Discover certificate SAN names.
- Find passive DNS relationships.
- Identify related domains and brand-adjacent candidates.
- Find observed services without scanning directly.
- Find parent-company, subsidiary, acquisition, and rebrand candidates that may
  be covered by bounty rules.
- Find websites connected by analytics codes, tag manager IDs, ad pixels, or
  single-pixel tracking endpoints.

Instant Domain Search should be treated as a domain intelligence provider, not
as proof of ownership. Its results should normally become `domain_candidate`
observations with `scope_status = unknown` and `requires_review = true`.

Acquisition and parent-company discoveries should also remain candidates until
the user confirms the bounty program policy allows them.

Provider enrichment should be automatic and provider-agnostic. When the user
starts this recon area, A.U.R.A should run every configured passive provider
that matches the target and available credentials, including Censys, Shodan,
WhoisXMLAPI, RDAP/WHOIS providers, Rapid7/Open Data, and future provider
adapters. Missing credentials should produce a low-noise skipped-provider event,
not a failed run.

The UI should not treat this as a separate "asset discovery" product area.
It belongs inside Recon alongside JavaScript files, endpoints, archived URLs,
parameters, historical data, provider leads, and correlation pivots.

WHOIS/RDAP term suggestion should run before Reverse WHOIS when possible:

- Fetch public RDAP/WHOIS data for in-scope root domains.
- Extract organization, registrant, and contact names.
- Skip privacy, proxy, redacted, registrar-only, or abuse-contact records.
- Suggest bounded include terms and default exclusions for Reverse WHOIS.
- Let the AI explain why terms were suggested or skipped, but keep the final
  provider discovery action user-controlled.

Alternate TLD correlation should run automatically during target bootstrap:

- Extract the registrable label from in-scope root domains.
- Generate bounded candidates across common TLDs.
- Exclude exact existing roots and explicit out-of-scope domains.
- Store results as `domain_candidate`/asset leads with evidence.
- Include alternate TLD candidates in the enumeration seed set only after the
  user confirms authorized scope for the run.
- Keep alternate TLD discoveries clearly attributed to the intel phase so users
  can audit why they were scanned.

## Phase 3a: Tracking Identifier Correlation

Use cases:

- Discover related websites through reused analytics or tracking identifiers.
- Pivot from target pages to other domains using shared measurement IDs.
- Detect brand, campaign, or subsidiary sites that reuse the same tracking stack.

Signals:

- Google Analytics IDs such as `UA-*` and `G-*`.
- Google Tag Manager IDs such as `GTM-*`.
- Meta/Facebook Pixel IDs.
- LinkedIn Insight Tag IDs.
- Hotjar, Segment, Amplitude, Mixpanel, Matomo, Plausible, and similar IDs.
- Single-pixel tracking URLs and beacon endpoints.
- Third-party script configuration containing account or workspace IDs.

Sources:

- Crawled HTML artifacts.
- JavaScript artifacts.
- Search engine results where allowed.
- Public source code references.
- Provider datasets that index analytics IDs where configured.

Outputs:

- Tracking identifiers.
- Related website candidates.
- SaaS provider observations.
- Correlation edges.
- Review items.

Rules:

- Related websites found through tracking IDs are not automatically in scope.
- Tracking ID matches should be `domain_candidate` observations with
  `scope_status = unknown` unless the scope explicitly covers them.
- Store the specific identifier, source artifact, matched domain, confidence,
  and first/last seen timestamps.
- Do not use tracking or pixel endpoints for active user/session tracking.

## Phase 4: Active Subdomain Enumeration

Default tools:

- `dnsx`
- `puredns`
- `shuffle-dns`
- `massdns`
- `ffuf` for vhost discovery

Optional tools:

- `subbrute`
- `gotator`
- `dnsgen`
- `altdns`

Rules:

- Active enumeration belongs to Standard or Full profiles, depending on intensity.
- Brute force belongs to Full by default.
- Permutation and alteration enumeration should generate candidates from already
  known subdomains, then feed DNS validation.
- DNS wildcard detection must run before brute force or permutation validation.
- Wordlists must be user-selectable.
- Concurrency, timeout, retries, and stop conditions must be visible in the UI.

Permutation inputs:

- Known resolved subdomains.
- Technology and region hints.
- Environment naming patterns such as `dev`, `staging`, `qa`, `beta`, `api-v2`,
  and regional suffixes.
- AI-assisted naming patterns learned from the target's own discovered
  subdomains.

Permutation outputs:

- Candidate domains.
- Source derivation metadata.
- Follow-up DNS validation jobs.

A.U.R.A should generate smart domain wordlists from observed subdomain labels.
The first implementation can be deterministic: split labels into service,
environment, product, and region tokens, then generate bounded combinations
such as `env-token`, `token-env`, `region-token`, and `token-region`. The AI
copilot may later explain, rank, or refine these candidates, but generated
entries must remain tied to observed naming evidence.

Wildcard DNS handling:

- Generate random subdomains under each root domain.
- Resolve them before brute force.
- If random names resolve, record wildcard origin IPs and response fingerprints.
- Filter brute-force candidates matching wildcard DNS and HTTP fingerprints.
- Store wildcard evidence as DNS observations tagged `wildcard_origin`.
- Prefer tools such as `puredns` when native wildcard filtering is needed.

## Phase 5: DNS Resolution And Record Collection

Default tools:

- `dnsx`
- `puredns`

Record types:

- A
- AAAA
- CNAME
- MX
- TXT
- NS
- PTR

Outputs:

- `dns_record` observations.
- Host to IP mappings.
- CNAME chains.
- Reverse DNS observations.
- Takeover candidates.
- Email security records.
- SPF include mechanisms.
- DKIM selector candidates.
- AXFR results where allowed by nameservers.

Resolved domains can feed Shodan and Censys enrichment jobs.

Dangling CNAMEs, unresolved service-specific hostnames, and known takeover
patterns should become `takeover_candidate` observations with evidence and
manual-review status.

TXT records should be parsed for SPF, DKIM, DMARC, and provider hints. SPF
`include:` mechanisms and MX records can reveal third-party providers, delegated
infrastructure, and technology choices. These should become
`email_security_record`, `technology`, or `review_item` observations as
appropriate.

Optional AXFR checks should attempt zone transfers against discovered NS records
with conservative timeouts. Successful transfers should be stored as raw
artifacts and parsed into high-confidence DNS observations. Failed transfers are
expected and should be low-noise events.

## Phase 5a: CDN Origin Discovery

Use cases:

- Identify origin candidates behind Cloudflare, Fastly, Akamai, CloudFront, and
  similar CDNs.
- Correlate old DNS, certificates, favicon hashes, headers, and provider data.

Inputs:

- DNS records and historical DNS records.
- HTTP probing results.
- Favicon hashes.
- Certificates and SANs.
- Shodan/Censys/Rapid7 observations.
- MX and SPF provider hints.
- Reverse IP and shared-hosting observations.

Techniques:

- Favicon hashing with MurmurHash3 and provider searches such as Shodan
  `http.favicon.hash`.
- Historical A record lookup through configured passive DNS providers.
- Certificate and SAN correlation through CT logs and Censys.
- MX and SPF provider correlation.
- Header leak detection for backend names, internal addresses, or server
  identifiers.
- Response similarity and title/body hash correlation.
- Reverse IP and shared virtual host correlation.

Outputs:

- Origin candidates.
- Evidence links.
- Confidence.
- Review items.

Rules:

- Origin candidates are not automatically in scope.
- Direct probing of origin candidates requires explicit user confirmation and
  scope review.
- The phase should prefer passive/provider evidence before any active validation.

## Phase 6: HTTP Probing

Default tool:

- `httpx`

Preferred output:

- JSON or JSONL.

Captured fields:

- URL.
- Host.
- Scheme.
- Port.
- Status code.
- Title.
- Web server.
- Technologies.
- Final URL.
- Content length.
- IP.
- HTTP version.
- `Alt-Svc` header.
- HTTP/2 support.
- HTTP/3 support signal.
- CSP directives.

HTTP probing should use controlled concurrency and backoff.

HTTP probing should also tag surfaces that may be less tested:

- Non-standard ports.
- Forgotten admin or support portals.
- Old brands and acquired-company domains.
- Mobile-specific hosts.
- Staging, QA, dev, beta, demo, and legacy naming patterns.

HTTP probing should compute lightweight fingerprints where possible:

- Title hash.
- Favicon hash.
- Body hash or simhash where available.
- Status plus content-length bucket.
- Header signatures.

CSP headers should be parsed as intelligence:

- `script-src` can reveal trusted CDNs and JavaScript providers.
- `connect-src` can reveal API, WebSocket, analytics, and telemetry endpoints.
- `img-src` can reveal image CDNs, storage providers, and tracking pixels.
- `frame-src` can reveal embedded SaaS providers.
- `report-uri` and `report-to` can reveal reporting infrastructure.

Hostnames extracted from CSP should become domain candidates, SaaS provider
observations, third-party script observations, or review items depending on
scope and provider recognition.

## Phase 6a: WAF And Security Control Fingerprinting

Default tools/signals:

- `wafw00f`
- Passive header analysis.
- Response pattern analysis.
- Security header analysis.

Outputs:

- WAF vendor and confidence.
- CDN vendor.
- Bot protection indicators.
- Rate limit evidence such as `Retry-After` or `X-RateLimit-*`.
- Security header coverage, including CSP, HSTS, and X-Frame-Options.

Rules:

- This phase documents controls; it must not attempt bypasses.
- Findings should become `security_control`, `technology`, or `review_item`
  observations.
- The AI copilot may use these observations to explain surface context and
  prioritize review, not to suggest evasion.

## Phase 6b: Well-Known File Discovery

Default resources:

- `/.well-known/security.txt`
- `/robots.txt`
- `/sitemap.xml`
- `/sitemap_index.xml`
- `/humans.txt`
- `/crossdomain.xml`
- `/clientaccesspolicy.xml`
- `/.well-known/assetlinks.json`
- `/.well-known/apple-app-site-association`
- `/openapi.json`
- `/swagger.json`
- `/api-docs`
- `/.well-known/openid-configuration`
- `/oauth/token`
- `/oauth/authorize`

Outputs:

- Well-known resources.
- URLs.
- API documentation artifacts.
- Mobile app package/bundle identifiers.
- API routes.
- Authentication surfaces.
- Review items.

Rules:

- Well-known checks belong to Standard by default.
- Requests should be low volume and rate-limited.
- `assetlinks.json` and `apple-app-site-association` should feed mobile app
  endpoint extraction and domain intelligence.
- OpenAPI/Swagger resources should feed API route discovery.

## Phase 6d: Debug, Health, And Admin Surface Discovery

Default resources:

- `/actuator`
- `/actuator/env`
- `/actuator/mappings`
- `/metrics`
- `/health`
- `/debug`
- `/debug/vars`
- `/__debug__`
- `/internal`
- `/admin/debug`
- `/server-status`
- `/server-info`
- `/phpinfo.php`
- `/_profiler`
- `/telescope`
- `/horizon`
- `/sidekiq`

Outputs:

- Path observations.
- Debug surface review items.
- Technologies.
- Template check candidates.

Rules:

- Debug and health checks belong to Standard or Full depending on profile
  intensity.
- Requests should be low volume and scoped to known live HTTP services.
- Findings should be tagged `debug_surface`.
- Matching nuclei informational templates should be suggested, not automatically
  escalated to exploit checks.

## Phase 6e: Authentication Surface Mapping

Signals:

- URL patterns such as `/login`, `/signin`, `/auth`, `/oauth`, `/sso`, `/saml`,
  `/callback`.
- Password fields in forms.
- `WWW-Authenticate` headers.
- Session, token, JWT, and auth cookie names.
- `401` responses with authentication headers.
- Well-known OpenID configuration.
- OAuth authorize/token endpoints.
- JavaScript references to `redirect_uri`, `client_id`, SAML, OIDC, JWT, or MFA.

Outputs:

- Authentication surface observations.
- Login URLs.
- Auth provider hints.
- Review items.

Auth surface types:

- `form_login`
- `oauth`
- `saml`
- `oidc`
- `api_key`
- `basic_auth`
- `jwt`
- `mfa`

Rules:

- Auth surface mapping is passive and observational.
- Do not attempt login, credential stuffing, or bypass testing in MVP.
- Auth surfaces should feed application surface mapping and triage priority.

## Phase 6c: Port And Service Discovery

Default tools:

- `naabu`
- `nmap`
- Shodan and Censys host enrichment

Outputs:

- Open ports.
- Service names.
- HTTP-like services on non-standard ports.
- Service banners where available.
- Follow-up HTTP probing jobs for web-capable services.

Rules:

- Port/service discovery belongs to Full by default.
- It requires explicit scope confirmation.
- Default behavior should prioritize discovering web services over broad network
  assessment.
- Users must be able to cap port ranges, concurrency, timeout, and host counts.

## Phase 7: Archive URL Discovery

Default tools/providers:

- `gau`
- `waybackurls`
- Common Crawl providers

Outputs:

- URLs.
- Paths.
- Query strings.
- Parameters.
- Extensions.
- Source attribution.

Archived URLs should be scope-filtered and deduplicated before later phases.

## Phase 7a: Wayback Gap Analysis

Use cases:

- Compare archived URLs with currently discovered URLs.
- Identify deprecated endpoints that still respond.
- Identify parameters present in archives but missing from current crawls.
- Identify resurrected or forgotten surfaces.

Inputs:

- Archived URLs.
- Current crawl URLs.
- HTTP probing results.
- Parameter observations.

Outputs:

- Archived-only URLs.
- Still-live archived URLs.
- Deprecated endpoint candidates.
- Parameter discovery candidates.
- Review items.

Rules:

- Live checks should be lightweight and rate-limited.
- Gap results should become `archived_gap` observations with source URLs and
  current status.
- Deprecated endpoints that still return useful responses should be prioritized
  for manual review.

## Phase 8: Crawling And URL Discovery

Default tools:

- `katana`
- `hakrawler`
- `gospider`

Rules:

- Crawling belongs to Full by default.
- Depth, duration, max URL count, same-host behavior, and JavaScript crawling
  must be configurable.
- Raw crawler output should be preserved.
- JSONL output should be preferred when available.
- Headless or JavaScript-aware crawling, such as `katana` with JS crawling
  enabled, should be treated as a separate higher-cost mode from static crawling.
- Network request capture should be available for JavaScript-heavy targets.

Authenticated crawling is not required for the first MVP, but the design should
reserve support for user-provided cookies, headers, and captured sessions.
Authenticated inputs must be stored carefully, masked in UI logs, and scoped to
specific targets and runs.

Crawler and HTML artifacts should preserve third-party script references for
supply chain analysis.

Network request capture outputs:

- XHR/fetch URLs.
- Request methods.
- Request headers with secrets redacted.
- JSON body parameter names and shape.
- WebSocket upgrade endpoints.
- API hosts not found by static crawling.
- HAR artifacts.

Headless browser pool:

- Prefer Playwright for Chromium/Firefox/WebKit support.
- Limit concurrent browser instances per target.
- Capture rendered DOM after JavaScript execution.
- Capture network requests and response metadata.
- Enforce timeout and memory limits per browser job.
- Store HAR and rendered HTML as artifacts.

## Phase 9: JavaScript Analysis

Default tools:

- `subjs`
- `LinkFinder`
- `JSFinder`
- `gf` patterns
- `xnLinkFinder`

Outputs:

- JavaScript files.
- Third-party scripts.
- Tracking identifiers.
- Extracted endpoints.
- URLs.
- Interesting strings.
- Candidate parameters.
- Potential secrets as observations requiring manual review.
- Dependency and sourcemap references.

Rules:

- Do not validate extracted credentials automatically in MVP.
- Mark sensitive matches as review items with artifact references.
- JavaScript endpoints discovered from GitHub/code search should feed this phase
  as passive inputs.
- Public sourcemaps, `package.json`, lockfiles, and exposed frontend manifests
  should be parsed when discovered and recorded as dependency observations.
- GF-style pattern matching should be available as a rule library over
  normalized URLs, parameters, JavaScript endpoints, and extracted strings.

Third-party scripts loaded from target pages should become `third_party_script`
observations. Pinned external library versions, missing SRI on critical scripts,
unusual CDN domains, and suspicious script origins should become dependency,
template finding, or review item observations as appropriate.

Analytics and pixel identifiers extracted from HTML or JavaScript should become
`tracking_identifier` observations and feed tracking identifier correlation.

## Phase 9a: Pattern Rule Analysis

Default rule families:

- Redirect candidates.
- SSRF-like URL parameters.
- SQLi-prone parameter names.
- XSS/reflection-prone parameter names.
- LFI/path traversal candidates.
- Debug, admin, token, key, callback, and webhook parameters.

Outputs:

- Pattern matches.
- Review items.
- Matched URL, parameter, or artifact reference.
- Rule category.

Rules:

- Pattern rules should be editable from the UI.
- GF-compatible patterns can be imported where licensing and format allow.
- Pattern matches are triage hints, not confirmed vulnerabilities.
- No payload validation should run automatically in MVP.

## Phase 10: Parameter Discovery

Default tools:

- `Arjun`
- `ParamSpider`
- `ffuf`

Outputs:

- Parameters.
- HTTP method metadata when available.
- Source URL.
- Confidence.

Rules:

- Passive parameter extraction belongs to Passive or Standard.
- Active parameter brute force belongs to Full.

## Phase 11: Content Discovery

Default tools:

- `feroxbuster`
- `ffuf`
- `dirsearch`

Outputs:

- Paths.
- URLs.
- Status codes.
- Response sizes.
- Redirects.

Rules:

- Content discovery belongs to Full by default.
- The UI must expose wordlist, recursion, depth, threads, status filters, and
  timeout controls.
- Interesting denied or gated paths, such as 401/403 responses, should become
  follow-up candidates instead of being discarded.
- Users should be able to launch scoped follow-up content discovery from a
  discovered path prefix.

Recommended wordlist families:

- SecLists Discovery/Web-Content.
- RAFT lists.
- Technology-specific lists based on detected stack.

## Phase 12: API Route Discovery

Default tools:

- `kiterunner`
- `katana`
- imported Postman/OpenAPI collections
- GitHub/code search importers
- Search engine dork importers

Outputs:

- API routes.
- Methods.
- Status codes.
- Content types.
- Source artifacts.
- GraphQL endpoints.
- WebSocket endpoints.
- Draft OpenAPI specs.

Rules:

- API route discovery should start from observed API hosts and known URL paths.
- Imported collections should be treated as artifacts and parsed into routes.
- Swagger/OpenAPI, GraphQL, Postman, and API docs found through dorks or code
  search should become first-class artifacts.
- Common GraphQL endpoints such as `/graphql`, `/api/graphql`, and `/v1/graphql`
  should be discovered as endpoints. Introspection should be flagged as a
  review item, not executed automatically in MVP.
- WebSocket URLs using `ws://` or `wss://` should become distinct
  `websocket_endpoint` observations.
- API route, parameter, method, content type, and status observations should be
  usable to reconstruct partial OpenAPI 3.x specs. These draft specs should be
  stored as artifacts and exportable for manual testing tools such as Burp or
  Postman.

Optional tools:

- `graphw00f` for GraphQL fingerprinting where configured.

## Phase 13: Cloud Asset Enumeration

Default tools:

- `cloud_enum`
- `s3scanner`
- AWS/GCP/Azure-specific passive checks where available

Outputs:

- Buckets.
- Storage endpoints.
- Cloud hostnames.
- Access status metadata.

Rules:

- Cloud asset enumeration belongs to Full by default.
- Any access check must remain non-destructive and within authorization.
- Bucket content dumping is not an MVP feature.

## Phase 14: ASN And Netblock Mapping

Default sources/tools:

- `amass intel`
- Shodan
- Censys
- RDAP

Outputs:

- ASNs.
- Netblocks.
- IPs.
- Host observations.
- Reverse IP domain candidates.
- Shared hosting correlations.

Rules:

- ASN and CIDR workflows are optional for MVP.
- They require explicit scope confirmation before active probing.

Reverse IP correlation should use provider data such as Shodan, Censys, Bing
`ip:` searches where available, HackerTarget-style APIs, PTR records, and
forward validation. Results should become `domain_candidate` observations with
`scope_status = unknown` unless explicitly covered by the target scope.

## Phase 15: Screenshots And Visual Triage

Default tools:

- `gowitness`
- `aquatone`
- `EyeWitness`

Outputs:

- Screenshot artifacts.
- Local report paths.
- Service metadata.

Screenshot tools should only receive scoped live HTTP services.

## Phase 16: Technology Fingerprinting

Default:

- `httpx -tech-detect`

Future:

- Wappalyzer engine or package.
- Headless browser pass.
- BuiltWith-style provider integration where available.
- `retire.js` for JavaScript dependency metadata.
- CMS-specific detectors such as `wpscan` or `CMSeeK` when applicable.

Outputs:

- Technologies.
- Versions when available.
- Confidence/source metadata.

Technology results should feed follow-up recommendations, including
technology-specific content discovery, CMS checks, and dependency review. MVP
should record these as review suggestions, not automated exploitation.

## Phase 16a: Informational Template Checks

Default tool:

- `nuclei`

Allowed MVP usage:

- Passive templates.
- Informational templates.
- Exposure and misconfiguration templates that do not exploit or mutate state.
- Technology and version detection templates.

Outputs:

- Template findings.
- Matched URL or host.
- Severity from the template.
- Evidence excerpt where safe.
- Template ID and version.
- Raw artifact.

Rules:

- Nuclei belongs to Full by default.
- The UI must clearly separate informational checks from vulnerability testing.
- Destructive, intrusive, exploit, brute-force, or high-noise templates must be
  disabled by default.
- Users should be able to select template tags, severity, rate limits, and target
  subsets.
- Template findings should become `template_finding` observations and review
  items, not automatically confirmed vulnerabilities.

## Phase 16b: Application Surface Mapping

This phase turns raw recon into a map of application areas.

Inputs:

- Live HTTP services.
- Titles.
- Redirects.
- Screenshots.
- Technologies.
- Interesting paths.
- Authentication hints.
- Mobile or API hostnames.
- Response fingerprints and similarity clusters.
- Template findings.
- Pattern matches.
- Security controls.
- SaaS provider observations.
- Correlation graph edges.
- Priority scores.

Outputs:

- Application clusters.
- Login/admin/support areas.
- Mobile web surfaces.
- Legacy or low-traffic surfaces.
- API surfaces.
- Interesting status-code clusters.
- Similar-response clusters.
- New or changed surfaces since the previous run.
- Priority-ranked triage entries.

The purpose is to help the user find the road less traveled: surfaces that are
in scope but less likely to have been heavily assessed.

Response similarity can start with lightweight features from `httpx` output:

- Status code.
- Title.
- Content-length bucket.
- Favicon hash.
- Header signature.
- Body hash where collected.

## Phase 16c: Third-Party SaaS Surface Mapping

Use cases:

- Map SaaS providers used by the target.
- Identify delegated support, marketing, analytics, email, CRM, and customer
  success surfaces.
- Create review items when provider-backed subdomains may be in scope.

Signals:

- Third-party JavaScript.
- Tracking identifiers and pixels.
- MX records.
- SPF includes.
- CNAMEs to known providers.
- Cookies and provider-specific cookie names.
- Response headers.
- Certificate SANs.
- Well-known app association files.

Outputs:

- SaaS provider observations.
- Provider category.
- Linked target domains or services.
- Confidence.
- Review items.

Rules:

- SaaS provider discoveries are not automatically in scope.
- Provider mapping should feed technology detection, application surface mapping,
  and playbook suggestions.

## Phase 16d: Change Detection Between Runs

Use cases:

- Detect newly discovered in-scope assets.
- Detect disappeared or newly unresolved domains.
- Detect changed technologies, titles, status codes, or redirects.
- Surface possible takeover candidates from assets that disappeared or changed
  DNS state.

Outputs:

- Run deltas.
- New assets since last run.
- Missing assets since last run.
- Changed services.
- Notification events.

Rules:

- Delta comparison should run automatically after normalization and promotion.
- Every rescan should compare the current run with the previous run for the same
  target and surface added, removed, and stable domains, URLs, and HTTP
  services in the UI and exports.
- Users should be able to compare any two runs for the same target.
- Notifications should be configurable and local-first.
- Change detection should store evidence and previous/current values.

## Phase 16e: Scope Change Monitoring

Use cases:

- Detect new domains, wildcards, URLs, or scope entries added to a bounty program.
- Detect assets removed from scope.
- Trigger recon suggestions when new in-scope assets appear.

Inputs:

- Bounty platform scope pages.
- User-uploaded scope exports.
- Stored policy snapshots.

Outputs:

- Scope deltas.
- Notification events.
- New seed candidates.
- Authorization record updates.

Rules:

- Scope monitoring should not automatically scan newly added scope without user
  confirmation.
- Scope snapshots should be stored with timestamps and hashes.
- Removed scope should affect future promotion and active-job eligibility.

## Phase 16f: Raw Artifact Search

Power users should be able to search raw artifacts directly, independent of
parsers.

Search inputs:

- Regex or literal query.
- Artifact type filter.
- Target/run/artifact scope.
- Output mode such as highlight or review item.

Use cases:

- Find patterns parsers missed.
- Search custom secrets or endpoint patterns.
- Debug parser behavior.
- Investigate a newly discovered term across historical artifacts.

Rules:

- Search results should link to artifact path, offset or line number where
  available, and surrounding safe excerpt.
- Secret-like matches should be redacted in UI unless the user explicitly opens
  the artifact.
- Saved searches can become pattern rules or review items.

## Phase 17: Asset Promotion

All raw discoveries enter as observations. Promotion creates stable assets.

Promotion examples:

- In-scope domain with DNS resolution -> `resolved_domain_asset`.
- In-scope host with live HTTP -> `web_asset`.
- URL with parameters -> `app_surface`.
- Certificate SAN in scope -> `candidate_domain`.
- Cloud asset with target naming evidence -> `cloud_asset_candidate`.

Promotion should record:

- Reason.
- Evidence.
- Source observations.
- Scope status.
- Confidence.

## AI Copilot Role

A.U.R.A should support an AI copilot backed by OpenCode on the Linux execution
environment. On Windows, this normally means OpenCode runs inside WSL. On Linux
desktop/server, OpenCode can run natively.

The first A.U.R.A run should detect whether OpenCode is available in the selected
execution environment. If it is missing, the UI should offer a guided bootstrap
flow instead of installing it silently.

Bootstrap flow:

- Show the install command and target environment.
- Ask the user to approve the installation.
- Install system prerequisites such as certificates, `curl`, `git`, build
  tools, archive utilities, `jq`, and Go.
- Install OpenCode using an official installation method.
- Verify `opencode` is available.
- Ask the user to select or configure the preferred model/provider.
- Verify OpenCode can answer a basic local prompt.
- Let OpenCode help install and verify recon tools from the tool registry.

The Web UI should expose OpenCode model/provider management:

- Current provider.
- Current model.
- Available configured providers.
- Available configured models.
- Provider/API credential status without exposing secrets.
- Add, update, deactivate, or rotate provider credentials.
- Select the default model for planning.
- Select the default model for execution/tool assistance.
- Run a test prompt against the selected model.
- Show model health, last test status, and last error.

Credential rules:

- API keys must be masked in the UI and logs.
- Secrets should be stored in the execution environment or A.U.R.A secret store,
  not in plain project files.
- OpenCode provider configuration changes should be audited.
- The user should be warned before switching to a paid or high-cost model.
- Model/provider changes should not affect an already running job unless the user
  explicitly applies the change to that run.

OpenCode may help with:

- Installing missing recon tools.
- Explaining failed installs.
- Checking tool versions.
- Suggesting safe profile/tool choices.
- Summarizing run data.
- Querying normalized recon data through A.U.R.A-provided context.

OpenCode should not directly mutate A.U.R.A state unless the action is routed
through A.U.R.A APIs with explicit user approval, audit logging, and permission
checks.

The AI chat widget should initially be read-only for recon actions.

Allowed:

- Explain current run status.
- Summarize collected assets.
- Find interesting domains, services, technologies, parameters, and errors.
- Suggest next recon phases within the configured scope.
- Explain tool failures and missing prerequisites.
- Assist with environment setup after user approval.

Not allowed in MVP:

- Launch scans automatically.
- Change scope.
- Modify API keys.
- Delete data.
- Run arbitrary shell commands without a user-approved setup or tool action.
- Suggest evasion, ban avoidance, or out-of-scope activity.

Recommended implementation:

- A.U.R.A owns the Web UI, DB, job queue, tool registry, and artifact store.
- OpenCode is an optional local agent runtime behind an `AgentProvider`
  interface.
- The chat UI talks to A.U.R.A, not directly to the OpenCode process.
- A.U.R.A builds scoped context from the selected target/run and sends that
  context to OpenCode.
- A.U.R.A exposes approved actions such as `check_tool`, `install_tool`,
  `explain_run`, and `summarize_assets`.
- A.U.R.A exposes AI configuration actions such as `list_ai_providers`,
  `set_ai_provider`, `set_ai_model`, `test_ai_model`, and
  `rotate_ai_credential`.
- Every agent action should be recorded as an event.
- OpenCode should receive `docs/OPENCODE_AGENT_PROMPT.md` as its default
  project brief when helping users expand or modify A.U.R.A.

## Sources And Inspiration

This methodology incorporates common bug bounty recon phases and tool categories,
including ideas from:

- `amrelsagaei/Bug-Bounty-Hunting-Methodology-2025`
  - Reconnaissance and subdomain enumeration.
  - Discovery and probing.
  - JavaScript analysis.
  - URL and archive discovery.
  - Parameter, content, API, cloud, and ASN enumeration.
- `jhaddix/tbhm`
  - Finding less-tested application surfaces.
  - Acquisition and parent-company research.
  - Port scanning for obscure web services when authorized.
  - Directory brute-force follow-up from denied or interesting paths.
  - Platform identification and mapping.
- Rapid7 Open Data / Project Sonar.
- Shodan.
- Censys.
- Instant Domain Search.
- OpenCode.
