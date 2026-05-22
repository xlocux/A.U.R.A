# A.U.R.A Architecture

A.U.R.A is a local-first, AI-driven bug bounty web recon workbench.

The architecture is designed to run well on a single workstation today and to
support distributed workers later without rewriting the core system.

## Product Principles

- AI-first development: all AI-assisted changes must follow the documented
  architecture and keep documentation current.
- UI-first: every major capability must be available from the Web UI.
- Browser-first operation: product workflows should not require local helper
  scripts. Local scripts are acceptable only for development, testing, and
  starting the Web UI.
- The Web UI must require authentication. The first local user defaults to
  `locu:locu` and is stored locally with a password hash. Exposed/server
  deployments must change the default credential and bind intentionally.
- Tabbed macro sections: major workflows should live in dedicated Web UI tabs.
- AI-assisted everywhere: the chat agent should help with every major workflow.
- Local-first: default storage and execution should work on one machine.
- Distributed-ready: core boundaries should support remote workers later.
- Tool-driven: use mature tools and provider APIs instead of custom scanners.
- Artifact-first: preserve raw tool/provider output before parsing.
- Evidence-based: normalized data must link back to artifacts and jobs.
- Scope-safe: unknown and out-of-scope discoveries must not be promoted silently.
- Modular: tools, providers, parsers, phases, workers, and models are replaceable.
- No monoliths: files and modules should have focused responsibilities.
- English-only: all user-facing text, documentation, prompts, events, and
  generated output must be in English unless explicitly configured otherwise.

## Development Governance

Every new feature must:

- Fit the architecture in this document.
- Use or extend a core interface instead of bypassing it.
- Keep implementation modular and avoid monolithic files.
- Preserve raw artifacts before parsing.
- Link normalized data back to evidence.
- Respect scope evaluation before asset promotion or active follow-up.
- Be reachable from the Web UI when user-facing.
- Fit the tabbed macro-section UI structure when adding user-facing screens.
- Be assistable by the AI chat agent when workflow-related.
- Include tests for public behavior.
- Update relevant documentation in the same change.
- Update `docs/OPENCODE_AGENT_PROMPT.md` when agent behavior, autonomy,
  interfaces, safety rules, or workflows change.

Documentation that may need updates:

- `docs/ARCHITECTURE.md`
- `docs/RECON_METHODOLOGY.md`
- `docs/UI_DESIGN.md`
- `docs/ROADMAP.md`
- `docs/OPENCODE_AGENT_PROMPT.md`

## High-Level Shape

```text
Web UI
  -> Local API server
  -> Application services
  -> Core ports/interfaces
  -> Local adapters now
  -> Distributed adapters later
```

Default local mode:

```text
Browser UI
  -> Node.js local API
  -> SQLite control DB
  -> Filesystem artifact store
  -> Local job queue
  -> WSL tool runner on Windows
  -> Native Linux tool runner on Linux
  -> OpenCode agent provider
```

Future distributed mode:

```text
Browser UI
  -> API server
  -> Postgres control DB
  -> S3-compatible artifact store
  -> Redis/SQS/Postgres queue
  -> Local or remote Linux workers
  -> OpenCode or other agent providers
```

## Core Interfaces

- `TargetStore`: target configs, scope rules, policy snapshots, authorization records.
- `RunStore`: runs, phases, status, checkpoints, events.
- `JobQueue`: queued/dispatched/running/completed jobs.
- `WorkerRegistry`: worker capabilities, heartbeats, installed tools.
- `ArtifactStore`: raw stdout/stderr, JSONL, HAR, screenshots, reports, exports.
- `ToolRegistry`: declarative tool manifests.
- `ParserRegistry`: parser definitions and output contracts.
- `ProviderRegistry`: API/passive data providers.
- `ToolRunner`: WSL/native/remote process execution.
- `AgentProvider`: OpenCode or compatible AI runtime.
- `ScopeEvaluator`: in-scope/out-of-scope/unknown decisions.
- `RateLimiter`: per provider/tool/target concurrency and backoff.
- `ObservationStore`: normalized observations and source links.
- `AssetPromotionService`: promoted assets with evidence.
- `CorrelationEngine`: graph edges and traversal.
- `PlaybookEngine`: conditional rules and action dispatch.
- `NotificationService`: UI/webhook/digest delivery.
- `FingerprintStore`: favicon/title/body/header fingerprints.
- `ChangeDetectionService`: run deltas and scope deltas.
- `ExportService`: Burp/Caido/Nuclei/CSV/JSON/SARIF/Markdown/Postman exports.
- `FalsePositiveStore`: dismissals, suppression rules, known noise.
- `MemoryStore`: target memory, snapshots, summaries.
- `ReasoningStore`: AI reasoning notes and evidence links.

## Data Flow

```text
input
  -> job
  -> raw artifact
  -> parser
  -> observation
  -> scope evaluation
  -> correlation edges
  -> optional promoted asset
  -> review item / export / notification / AI memory
```

Raw artifacts are the source of truth. Parsers can be improved and replayed
against saved artifacts.

## Job Lifecycle

```text
QUEUED -> DISPATCHED -> RUNNING -> SUCCEEDED
QUEUED -> DISPATCHED -> RUNNING -> FAILED
QUEUED -> DISPATCHED -> RUNNING -> TIMED_OUT
QUEUED/DISPATCHED/RUNNING -> CANCELLED
FAILED/TIMED_OUT -> QUEUED
```

Job payload:

- `job_id`
- `run_id`
- `target_name`
- `phase`
- `tool_id`
- `input_artifacts`
- `input_observations`
- `args`
- `env_secret_refs`
- `rate_limit_profile`
- `timeout_ms`
- `max_attempts`
- `scope_constraints`
- `output_policy`

Worker report:

- `status`
- `exit_code`
- `started_at`
- `finished_at`
- `duration_ms`
- `stdout_artifact`
- `stderr_artifact`
- `additional_artifacts`
- `parser_status`
- `error_message`
- `heartbeat_at`

## Tool Registry

Tools are declared through manifests, not hardcoded.

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

Built-in manifests should live under:

```text
src/recon/tools/builtin/
```

Custom user manifests should live under:

```text
data/tool-registry/custom/
```

## Parser Contract

Parser input:

- `artifact_path`
- `job_id`
- `run_id`
- `target_name`
- `tool_id`
- `job_payload`

Parser output:

- list of observations

Observation fields:

- `type`
- `value`
- `confidence`
- `source_tool`
- `source_artifact`
- `scope_status`
- `raw_excerpt`
- `metadata_json`
- `requires_review`

Parser rules:

- Prefer JSON/JSONL when available.
- Keep parsers stateless.
- Link every observation to source artifact location where possible.
- Record parser errors as structured events.
- Never discard the raw artifact.

## Storage Strategy

SQLite remains the default local store for MVP.

Use SQLite for:

- targets
- scope rules
- runs
- jobs
- events
- observations
- promoted assets
- review items
- tool/provider/model metadata
- graph edges
- false-positive records
- memory summaries

Use filesystem for:

- stdout/stderr
- raw JSON/JSONL
- HAR files
- screenshots
- HTML reports
- large exports
- uploaded authorization files
- tool artifacts

Future large deployments can move:

- control DB to Postgres
- artifacts to S3-compatible storage
- queue to Redis/SQS/Postgres

## AI Architecture

OpenCode is the default local agent runtime.

```text
Chat UI
  -> A.U.R.A API
  -> context builder
  -> AgentProvider
  -> OpenCode
```

The chat UI never talks directly to OpenCode. A.U.R.A builds scoped context,
applies permission checks, redacts secrets, records audit events, and dispatches
approved actions.

AI actions are controlled by autonomy level:

- Level 0: read-only explanation.
- Level 1: suggestions.
- Level 2: prepare configs/plans.
- Level 3: user-confirmed execution.
- Level 4: guarded autopilot within pre-approved limits.
- Level 5: out of MVP.

## MVP Implementation Order

1. Documented architecture and UI direction.
2. Tool registry manifests and validation.
3. Local artifact store abstraction.
4. Job queue schema and local worker loop.
5. WSL/native Linux `ToolRunner`.
6. Basic parser registry.
7. Observation store and scope evaluation.
8. Environment setup UI.
9. Target/scope UI.
10. Run builder and live run UI.
11. OpenCode bootstrap and chat panel.
12. Asset/observation/review item views.
13. Export basics.

## English-Only Product Rule

All user-facing product text must be written in English:

- UI labels
- empty states
- errors
- toasts
- logs/events shown to users
- docs
- prompts
- AI chat responses inside A.U.R.A
- generated reports and exports unless the user explicitly selects another language
