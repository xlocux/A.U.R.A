# Adaptive Recon and Tool Health

A.U.R.A uses an AI-aware recon workflow for `https://github.com/xlocux/A.U.R.A.git`. The goal is to keep the AI assistant inside the operational loop as a diagnostic team member, not as a passive logger.

## What changed

Before every recon-style execution, A.U.R.A now performs an adaptive preflight benchmark. The benchmark records CPU cores, memory, a small CPU probe score, a selected profile, and recommended limits for tool concurrency, `httpx`, `dnsx`, screenshots, and timeout scaling.

The preflight is written to:

```text
data/recon-runs/<run-id>/adaptive-preflight.json
```

The run log also receives:

- an `adaptive-preflight` event with the selected profile
- an `ai-stage-awareness` event with the AI rationale

## Profiles

A.U.R.A currently selects one of three profiles:

- `conservative`: low CPU/RAM or low CPU probe score
- `balanced`: normal workstation or small server
- `aggressive`: larger host with enough CPU/RAM headroom

The selected profile affects:

- tool timeout multiplier
- `httpx` thread count
- `dnsx` thread count
- screenshot concurrency
- future batch sizing and stage workers

## Tool setup hardening

The setup flow now verifies that tools are callable from the same terminal PATH used by the recon runner.

The environment check validates:

- terminal PATH visibility
- Node.js, npm, Go, Git, curl, jq basics
- opencode availability for AI-assisted diagnostics
- declared recon tools from `src/recon/tools/builtin/*.json`
- explicit capability signatures where available

For `httpx`, the manifest now checks for ProjectDiscovery-style flags and JSON/status/technology capabilities. This avoids silently using a different `httpx` binary that does not produce the expected JSONL output.

For `gowitness`, the manifest now checks screenshot/file scan support so screenshot failures can be classified before full recon.

## AI-aware recovery classifier

`src/recon/recovery-classifier.js` classifies common failure modes:

- timeout
- binary missing or unavailable on PATH
- possible tool identity or flag mismatch
- screenshot browser dependency problem
- artifact filesystem problem
- zero parsed output
- missing screenshot artifacts

The classifier returns a severity, reasons, recommendation, and AI-aware summary. This is intended to feed the existing `ai-action-pool` and run logs so A.U.R.A can explain why a stage is blocked or degraded.

## Stage contract

`src/recon/stage-contract.js` introduces a standard stage payload:

```js
{
  stage,
  status,
  inputCount,
  outputCount,
  outputRatio,
  expectedArtifacts,
  artifacts,
  warnings,
  errors,
  aiAwareness
}
```

This prevents a full recon from looking successful when a required downstream stage produced no usable output. A run can be `completed` while individual stages are `degraded`; the AI log should make that distinction explicit.

## Current integration status

The adaptive benchmark is wired into runtime execution through `src/recon/recon-engine-runtime-patch.js`, loaded by `scripts/serve-web.js` before the web server imports API routes. It wraps:

- `runRecon`
- `runHttpFollowup`
- `runFocusedFollowup`

It also patches Linux tool execution so selected adaptive limits are applied to:

- `httpx`: thread, retry, and timeout flags
- `dnsx`: thread and retry flags
- `gowitness`: screenshot thread flag

## Recommended next refactor

The remaining structural improvement is to move `httpx` execution out of the generic `collectLinuxTools` loop into a dedicated `HttpProbeStage` that explicitly batches large domain sets using the benchmark `httpxBatchSize`. The current runtime patch reduces risk immediately, while the future stage split should give finer per-batch artifacts and recovery decisions.

## Operator workflow

1. Open `Settings > Environment`.
2. Run environment check.
3. Install/update tools if any required tool is missing or has a wrong capability signature.
4. Run environment check again.
5. Start recon only after `httpx`, `dnsx`, and screenshot tooling are visible on terminal PATH.
6. Review `adaptive-preflight` and `ai-stage-awareness` events in Runs & Logs.

The AI assistant should use these events when explaining why tech stack or screenshots are missing.
