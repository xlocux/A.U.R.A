# Vercel-style Dashboard Redesign

## Goal

Apply a Vercel-like cloud dashboard visual layer to the canonical A.U.R.A web UI without replacing the working operator screens.

Reference characteristics to mirror:

- Dark cloud-platform shell.
- Compact top navigation.
- Strong overview heading and primary actions.
- Modular cards for core entities.
- Applications-style cards mapped to A.U.R.A targets/runs/tools.
- Deployment-style table mapped to recent recon runs and deltas.
- System metrics cards mapped to domains, services, URLs, technologies, screenshots, events, and API/provider health.
- Live logs panel mapped to A.U.R.A run events, tool logs, warnings, and AI decisions.
- Environment/API settings rendered as a structured table instead of loose panels.

## Non-negotiable constraints

- Keep the canonical `index.html` panels and all existing DOM ids used by `app.js`.
- Preserve every DOM id currently used by `app.js` unless the owning JavaScript module is updated in the same change.
- No competing click handlers for the same control.
- No side-by-side dashboard shell that hides the real data panels.
- The visual layer must be CSS-first and must not replace data loading, filters, result subtabs, screenshots, API settings, proxy settings, logs, or AI panels.

## Implementation

The active dashboard uses:

- `public/web/index.html` for canonical markup and script loading.
- `public/web/app.js` and companion modules for all behavior and data population.
- `public/web/vercel-dashboard.css` for the Vercel-like color, cards, tabs, inputs, tables, and panel styling.

The removed side-by-side `dashboard-v2.*` route was intentionally discarded because it did not expose all of the legacy result data and created a second, incomplete UI path.

## Data mapping

- Project Overview -> current target, active run, authorization status, AI/provider readiness.
- Applications -> targets, runs, and major recon modules.
- Recent Deployments -> recent recon runs with status, target, branch-like mode, and timestamps.
- System Metrics -> domains, HTTP services, URLs, technologies, screenshots, events.
- Live Logs -> run events, tool logs, AI decisions, warnings/errors.
- Environment Variables -> API keys/providers and local environment status.

## QA checklist

- Canonical tabs still render: Recon, Wordlists, Search, Topology, Results, AI Log, Runs & Logs, Settings.
- All buttons have deterministic owners.
- Empty, loading, and error states are visible.
- Keyboard navigation works for nav, cards, tables, actions, and settings controls.
- Data panels render from real A.U.R.A APIs, not hard-coded demo data.
- No API call is made in a tight loop.
- No active recon action starts without explicit authorization.
