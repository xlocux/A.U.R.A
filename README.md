# A.U.R.A - Asset Unveiling & Reconnaissance Automation

A.U.R.A is a local-first recon workbench for authorized bug bounty, asset inventory, and security research scopes. It is designed to help an operator move from a small set of authorized seeds to a documented, evidence-backed map of domains, services, URLs, technologies, screenshots, and candidate assets.

A.U.R.A is not an exploit automation framework. The project focuses on discovery, validation, evidence preservation, correlation, triage, and safe follow-up planning. Active checks must stay inside explicitly authorized scope.

## Core Principles

- **Local first**: data is stored locally in SQLite and artifacts are written to the local filesystem.
- **Evidence first**: raw tool output is saved before parsing so every normalized observation can be traced back to source evidence.
- **Scope first**: unknown or weakly correlated assets are review leads, not automatic scan targets.
- **UI first**: target setup, recon controls, API keys, wordlists, run logs, results, exports, and AI assistance are managed from the Web UI.
- **AI assisted, not AI uncontrolled**: the AI explains, summarizes, correlates, and proposes next steps, but A.U.R.A remains the control plane.
- **Adaptive by default**: every recon-style run performs an AI-aware host benchmark before execution and adapts tool timeouts/concurrency to the current machine.
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

## Adaptive Preflight and Tool Health

Before each recon, HTTP follow-up, or focused follow-up, A.U.R.A runs an adaptive benchmark and writes:

```text
data/recon-runs/<run-id>/adaptive-preflight.json
```

The benchmark selects a conservative, balanced, or aggressive profile from CPU, memory, and a small CPU probe. The selected profile is added to run events as `adaptive-preflight` and `ai-stage-awareness`, then applied to tool execution for timeout scaling and selected `httpx`, `dnsx`, and `gowitness` limits.

Tool setup is documented in `docs/ADAPTIVE_RECON_AND_TOOL_HEALTH.md`. The environment check now validates terminal PATH visibility, tool identity, and capability signatures so the UI can detect cases where the wrong binary is installed or screenshot/browser dependencies are missing.

## High-Level Workflow

1. **Prepare environment**
   - Open `Settings > Environment`.
   - Run environment check.
   - Install or update Linux tools.
   - Confirm that required tools are available on the terminal PATH and have the expected capability signatures.

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
   - Select passive sources, Linux tools, screenshot tools, API-backed providers, and httpx port preset/custom ports.

5. **Confirm authorization**
   - Active enumeration requires the `Authorized scope` checkbox.
   - Without authorization, A.U.R.A can still perform passive bootstrap/intel checks but should not launch active enumeration.

6. **Run recon**
   - A.U.R.A collects passive evidence, runs selected tools, stores artifacts, parses observations, and updates live run status.
   - The adaptive preflight runs automatically before the engine starts active work.

7. **Review results**
   - Use `Results`, `Projects`, `Search`, `Topology`, `Runs & Logs`, and `AI Log`.
   - Review run deltas first to prioritize new assets and changes.

8. **Plan safe follow-up**
   - Use HTTP/Tech follow-up, screenshot follow-up, filtered exports, wordlist generation, or manual review.
   - Candidate assets remain review leads until authorized scope is updated.

## Web UI Tabs

See the in-product Guide and `docs/ADAPTIVE_RECON_AND_TOOL_HEALTH.md` for the full operator workflow, tool-health details, stage awareness, and AI-assisted diagnostics.
