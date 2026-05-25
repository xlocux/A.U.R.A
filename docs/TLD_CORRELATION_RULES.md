# TLD Correlation Rules

A.U.R.A evaluates alternate TLD candidates with a deterministic correlation
engine. The engine does not use ML and does not infer authorization from a
single weak clue.

## Confidence Signals

The score is capped at 100 and floored at 0.

- Certificate transparency evidence: `+60`
- DNS A-record resolution: `+20`
- Same WHOIS/registrar organization: `+15`
- Same known IP address: `+15`
- Authorized CIDR overlap: `+10`
- Favicon hash match: `+10`
- Nameserver overlap: `+10`
- Certificate SAN match with known domains: `+5`
- RDAP/acquisition ownership evidence: `+10`
- Explicit out-of-scope match: `-50`

## Promotion Rules

- `100`: auto-promoted as an in-scope promoted asset.
- `60-99`: kept as a review item with evidence and reasoning.
- `<60`: kept as a low-confidence candidate.

Auto-promotion requires an exact `100` confidence score and
`promotion_eligible: true`. Anything below 100 remains user-reviewable and must
not be scanned as authorized scope.

## Evidence Trail

Each correlated candidate stores:

- `correlationEngineResult.confidence_score`
- `correlationEngineResult.confidence_level`
- `correlationEngineResult.signals[]`
- `correlationEngineResult.reasoning`
- `correlationEngineResult.correlated_with[]`

The Results Explorer shows these fields under candidate detail, and AI Log
records auto-promotions and review decisions for auditability.

## API

Focused TLD discovery/correlation can be requested with:

```http
POST /api/v1/runs/{run_id}/phases/domain_intelligence/tld-discovery
```

Supported body fields:

- `registrable_label`
- `strategies`
- `correlation_engine_enabled`
- `auto_promotion_enabled`
- `correlation_sources`
- `confidence_threshold_for_review`

The response includes queued strategy jobs, correlation settings, evaluated
candidate count, and per-candidate correlation results.
