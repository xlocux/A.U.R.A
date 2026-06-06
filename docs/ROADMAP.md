# A.U.R.A Roadmap

A.U.R.A is evolving from a local recon dashboard into a local-first, AI-driven
bug bounty web recon workbench.

This roadmap is implementation-oriented. Methodology details live in
`docs/RECON_METHODOLOGY.md`, system architecture lives in `docs/ARCHITECTURE.md`,
and UI direction lives in `docs/UI_DESIGN.md`.

## Product Rules

- A.U.R.A is developed AI-first. AI agents must follow the documented
  architecture.
- All user-facing text must be in English.
- Every major capability must be available from the Web UI.
- Product workflows should not require local scripts; scripts are reserved for
  development and server startup tasks.
- The AI chat agent should assist every major workflow and recon phase.
- The AI chat panel should be visible across the main desktop workspace, with
  context-aware backend integration added through `AgentProvider`.
- Recon topology and graph views should be available from the Web UI, with
  realtime visual updates as graph/correlation data arrives.
- Raw tool/provider output must be preserved before parsing.
- Scope evaluation is mandatory before promotion or active follow-up.
- Tools, providers, parsers, phases, workers, and models must be modular.
- A.U.R.A remains the control plane for jobs, artifacts, scope, rate limits, and
  audit logs.
- Avoid monolithic files. Each module should have a focused responsibility.
- Documentation must be updated with every feature or architectural change.
- `docs/OPENCODE_AGENT_PROMPT.md` must be updated whenever agent behavior,
  autonomy, interfaces, workflows, or safety rules change.

## Phase 0: Foundations

Status: complete.

Deliverables:

- Recon methodology document. (done)
- Architecture document. (done)
- UI design direction. (done)
- OpenCode agent prompt. (done)
- English-only product rule. (done)

Exit criteria:

- Docs describe the MVP implementation boundaries.
- OpenCode has a project prompt for future development assistance.
- Architecture clearly defines local-first and distributed-ready boundaries.

## Phase 1: Modular Execution Core

Goal: replace hardcoded recon orchestration with a job-based, registry-driven
execution core.

Status: largely complete; refinement ongoing.

Deliverables:

- Tool registry manifest schema and validator. (done)
- Built-in tool manifests for initial recon tools. (done — subfinder, dnsx, httpx, gau, gowitness, retire.js)
- Parser registry and parser contract. (done — parsers.js, result-tree.js)
- Local artifact store abstraction. (done — scan-store.js, SQLite via node:sqlite)
- SQLite-backed job queue. (done — integrated into recon-engine.js)
- Local worker loop. (done — recon engine runs phases sequentially with AI action pool)
- Worker capability checks. (done — environment-setup.js, tool manifests with capability signatures)
- Local Linux tool runner. (done — linux-tools.js, runLinuxTool)
- Rate limit profile model. (done — adaptive-recon-profile.js: conservative, balanced, aggressive)
- Structured job events and tool result artifacts. (done — appendEvent, recordToolResult)

Adaptive execution:

- Adaptive preflight benchmark runs before each execution, recording CPU/RAM profile. (done)
- httpx runs in adaptive batches; each batch saved as artifact with partial service persistence. (done)
- dnsx thread count capped; retry minimum enforced. (done)
- gowitness thread count adapted from profile. (done)
- AI action pool runs recovery retries for zero-output, missing screenshot, missing URL artifacts. (done)
- httpx zero-output + proxy scenario triggers a direct-only retry action. (done)

Initial tools running in production:

- `subfinder`
- `dnsx`
- `gau`
- `httpx` (with adaptive batching and proxy fallback)
- `gowitness`
- `retire.js` (technology detection)

Exit criteria:

- A run is composed of phases orchestrated by recon-engine.js.
- stdout/stderr/raw outputs are stored as artifacts with file paths.
- Parsed observations link back to tool results and artifacts.
- Workers declare installed tool capabilities through environment-setup.js.

## Phase 2: Settings-Based Environment And OpenCode Setup UI

Goal: let users prepare the local Linux execution environment from the Web UI.

Status: largely complete; OpenCode integration partial.

Deliverables:

- `Settings > Environment` setup panel. (done)
- local Linux detection via WSL/native. (done)
- Tool install/check state with capability signatures. (done)
- OpenCode detection. (done — agentStatus in Settings > AI)
- Guided OpenCode bootstrap. (partial — AI settings panel present, full bootstrap flow pending)
- OpenCode provider/model management. (done — provider/model selectors in Settings > AI)
- Planning model and execution model settings. (done)
- Masked credential management. (done — API keys in Settings > API Keys)
- AI chat panel connected through A.U.R.A, not directly to OpenCode. (done — ai-agent.js)

Exit criteria:

- A user can configure the environment from the UI.
- A user can change OpenCode provider/model from the UI.
- The AI assistant can explain environment/tool failures.

## Phase 3: Target, Scope, And Authorization

Goal: make target and scope management reliable and auditable.

Status: in progress — target creation and basic scope done; authorization records and scope evaluation service pending.

Deliverables:

- Target creation UI. (done — create/delete from Recon tab)
- Scope editor for domains, wildcards, URLs, and out-of-scope rules. (partial — seed domain input done; structured in/out-of-scope editor pending)
- Structured scope import flow. (pending)
- Authorization record storage. (pending)
- Policy snapshot and uploaded authorization artifacts. (pending)
- Scope evaluation service. (pending)
- Scope confirmation gate before active phases. (pending)

Exit criteria:

- Every observation can be evaluated as `in_scope`, `out_of_scope`, or `unknown`.
- Active runs require explicit authorization confirmation.
- Target scope can be reviewed and edited from the UI.

## Phase 4: MVP Recon Pipeline

Goal: implement the production-quality MVP recon flow.

Status: core pipeline operational; see tool list for current support.

Currently operational phases:

- Target and seed setup. (done)
- Seed normalization and WHOIS/RDAP intel preflight. (done)
- Passive subdomain discovery via subfinder and API providers. (done)
- Domain intelligence and provider enrichment. (done — RDAP/WHOIS, alternate TLD correlation, Shodan/Censys via API keys)
- Active subdomain enumeration. (done — subfinder + dnsx)
- DNS resolution and record collection. (done — dnsx)
- HTTP probing. (done — httpx with adaptive batching)
- Archive URL discovery. (done — gau)
- Technology fingerprinting. (done — httpx -tech-detect + retire.js)
- Screenshot capture. (done — gowitness)
- Asset promotion for collected data. (done — auto-promote 100% TLD candidates, save domains/services/URLs/screenshots)
- AI correlation log. (done — candidate correlation techniques logged in AI Log tab)
- Focused follow-up runs for HTTP, URL/params, tech, screenshots, trackers, favicons. (done)
- Run delta comparison. (done — buildRunDelta)
- Export JSON/CSV/Markdown. (done)

Pending:

- Search engine dorking support.
- GitHub/code search support.
- DNS wildcard detection.
- CDN origin candidate discovery.
- Well-known file discovery.
- Crawling and URL discovery.
- Observation store (normalized with scope status and confidence per observation).
- Review item queue.
- Suppression rules.
- Scope evaluation gate.

Exit criteria:

- Users can create and run Passive, Standard, Full, and Custom profiles from UI.
- Users can inspect observations, promoted assets, and review items from UI.
- The AI assistant can summarize a run and propose safe next steps.

## Phase 5: Review, Export, And Operational UX

Goal: make the collected data practical for manual testing and repeat workflows.

Deliverables:

- Assets and observations tables.
- Review item queue.
- Dismissal reasons.
- Suppression rules.
- False-positive tracking.
- Export service.
- Burp/Caido target exports.
- Nuclei target list export.
- `ffuf` wordlist exports.
- CSV/JSON exports.
- Markdown/HTML run snapshots.
- SARIF export for review items/findings.
- Raw artifact search.

Exit criteria:

- Users can triage findings without leaving the UI.
- Users can export scoped data for common manual testing tools.
- Dismissed findings do not keep resurfacing as new noise.

## Phase 6: MVP Extended Recon Intelligence

Goal: add high-value recon intelligence after the core is stable.

Deliverables:

- Wayback gap analysis.
- AXFR checks.
- Debug and health endpoint discovery.
- CSP intelligence extraction.
- HTTP/2 and HTTP/3 metadata.
- Reverse IP correlation.
- Supply chain script tracking.
- WAF/security-control fingerprinting.
- Notification webhooks.

Exit criteria:

- Users can identify deprecated-but-live endpoints.
- Users can find debug/admin/health surfaces.
- Users can inspect security controls and CSP-derived intelligence.
- Users can receive alerts for high-value changes.

## Phase 7: Reasoning And Memory Layer

Goal: make A.U.R.A reason over history instead of only showing run outputs.

Deliverables:

- Historical memory store.
- Reasoning notes.
- Memory snapshots.
- Run delta comparisons.
- Correlation edge store.
- Graph traversal queries.
- AI context builder with evidence citations.
- Dismissed finding memory.

Exit criteria:

- The AI can distinguish facts, inferences, hypotheses, and unknowns.
- Users can ask what changed since a previous run.
- Correlated evidence is explainable through graph edges and artifact links.

## Phase 8: Playbooks And Guided Autonomy

Goal: let users encode repeatable recon decisions safely.

Deliverables:

- Conditional playbook rule schema.
- YAML rule editor.
- Rule test/dry-run view.
- Trigger audit trail.
- Conservative built-in playbook library.
- Level 3 user-confirmed actions.
- Foundation for Level 4 guarded autopilot.

Exit criteria:

- Users can create, test, and review playbook rules from UI.
- Playbooks can suggest or queue follow-up work with evidence.
- Every AI/playbook action is auditable.

## Phase 9: V2 Recon Capabilities

Goal: expand deeper recon capabilities once the MVP platform is stable.

Candidates:

- Real-time CT log monitoring.
- Third-party SaaS surface mapping.
- OpenAPI reconstruction.
- AI-assisted priority scoring.
- Authentication surface mapping.
- Network request capture.
- Headless browser pool with Playwright.
- Scope change monitoring.
- Mobile app endpoint extraction.
- Advanced graph correlation.

Exit criteria:

- A.U.R.A can operate as a continuous monitoring and triage workbench.
- AI priority scoring is evidence-backed and auditable.
- Scope changes and new assets can produce safe, user-confirmed follow-up flows.

## Later Distributed Mode

Goal: allow A.U.R.A to scale beyond one machine without changing core concepts.

Deliverables:

- Postgres adapter.
- S3-compatible artifact store adapter.
- Redis/SQS/Postgres queue adapter.
- Remote worker registration.
- Worker heartbeat and leasing.
- Remote artifact upload.
- Distributed rate limiting.

Exit criteria:

- Local mode and distributed mode share the same core interfaces.
- Remote workers can execute jobs without bypassing A.U.R.A control-plane rules.
