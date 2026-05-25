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

Status: in progress.

Deliverables:

- Recon methodology document.
- Architecture document.
- UI design direction.
- OpenCode agent prompt.
- English-only product rule.

Exit criteria:

- Docs describe the MVP implementation boundaries.
- OpenCode has a project prompt for future development assistance.
- Architecture clearly defines local-first and distributed-ready boundaries.

## Phase 1: Modular Execution Core

Goal: replace hardcoded recon orchestration with a job-based, registry-driven
execution core.

Status: started.

Deliverables:

- Tool registry manifest schema and validator. (started)
- Built-in tool manifests for initial recon tools. (started)
- Parser registry and parser contract.
- Local artifact store abstraction. (started)
- SQLite-backed job queue. (started)
- Local worker loop. (started)
- Worker capability checks.
- local Linux tool runner. (started)
- Rate limit profile model.
- Structured job events and tool result artifacts.

Initial tools:

- `subfinder`
- `dnsx`
- `gau`
- `httpx`
- `katana`
- `naabu`
- `nuclei`
- `gowitness`

Exit criteria:

- A run is composed of jobs, not one monolithic function.
- stdout/stderr/raw outputs are stored as artifacts.
- Parsed observations link back to artifacts.
- Workers can declare installed tool capabilities.

## Phase 2: Settings-Based Environment And OpenCode Setup UI

Goal: let users prepare the local Linux execution environment from the Web UI.

Deliverables:

- `Settings > Environment` setup panel. (started)
- local Linux detection. (started)
- Tool install/check state. (started)
- OpenCode detection.
- Guided OpenCode bootstrap.
- OpenCode provider/model management.
- Planning model and execution model settings.
- Masked credential management.
- AI chat panel connected through A.U.R.A, not directly to OpenCode.

Exit criteria:

- A user can configure the environment from the UI.
- A user can change OpenCode provider/model from the UI.
- The AI assistant can explain environment/tool failures.

## Phase 3: Target, Scope, And Authorization

Goal: make target and scope management reliable and auditable.

Deliverables:

- Target creation UI. (started)
- Scope editor for domains, wildcards, URLs, and out-of-scope rules.
- Structured scope import flow.
- Authorization record storage.
- Policy snapshot and uploaded authorization artifacts.
- Scope evaluation service.
- Scope confirmation gate before active phases.

Exit criteria:

- Every observation can be evaluated as `in_scope`, `out_of_scope`, or `unknown`.
- Active runs require explicit authorization confirmation.
- Target scope can be reviewed and edited from the UI.

## Phase 4: MVP Recon Pipeline

Goal: implement the production-quality MVP recon flow.

MVP phases:

- Target and scope setup.
- Seed normalization.
- Passive subdomain discovery.
- Search engine dorking support.
- GitHub/code search support.
- Domain intelligence and provider enrichment.
- Active subdomain enumeration with conservative defaults.
- DNS resolution and record collection.
- DNS wildcard detection.
- CDN origin candidate discovery.
- HTTP probing.
- Well-known file discovery.
- Archive URL discovery.
- Crawling and URL discovery.
- Asset promotion.

Deliverables:

- Observation store.
- Asset promotion service.
- Review item model.
- Confidence scoring.
- Deduplication and canonicalization.
- DNS wildcard filtering.
- HTTP fingerprints.
- Well-known resource checks.
- Raw artifact links from every observation.

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
