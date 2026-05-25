# Vercel-style Dashboard Redesign Branch

## Goal

Create a separate UI redesign path inspired by the Vercel-like reference dashboard while keeping `main` stable and functional.

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

- Do not break `main`.
- Do not rewrite `index.html` in place until the new shell is validated.
- Preserve every DOM id currently used by `app.js` unless the owning JavaScript module is updated in the same change.
- No competing click handlers for the same control.
- No global CSS that changes layout of existing screens accidentally.
- Each new UI module must own its markup, data loading, state, empty/loading/error states, and cleanup.

## Proposed implementation path

### Phase 1: Side-by-side prototype

Add an isolated route/file such as `public/web/dashboard-v2.html` with dedicated files:

- `dashboard-v2.css`
- `dashboard-v2.js`

This route should read existing APIs but not replace the current operator UI.

### Phase 2: Data mapping

Map A.U.R.A data to dashboard concepts:

- Project Overview -> current target, active run, authorization status, AI/provider readiness.
- Applications -> targets, runs, and major recon modules.
- Recent Deployments -> recent recon runs with status, target, branch-like mode, and timestamps.
- System Metrics -> domains, HTTP services, URLs, technologies, screenshots, events.
- Live Logs -> run events, tool logs, AI decisions, warnings/errors.
- Environment Variables -> API keys/providers and local environment status.

### Phase 3: Component migration

Introduce components one at a time:

- App shell and nav.
- Overview header.
- Metric cards.
- Entity cards.
- Recent runs table.
- Live logs stream.
- Settings/API table.
- Topology preview card.

### Phase 4: Replace current shell only after validation

After side-by-side validation, migrate from `index.html` to the new dashboard shell by preserving required ids or moving the logic into dedicated modules.

## QA checklist

- Current `main` UI still works independently.
- `dashboard-v2.html` loads with no console errors.
- All buttons have deterministic owners.
- Empty, loading, and error states are visible.
- Keyboard navigation works for nav, cards, tables, actions, and settings controls.
- Data panels render from real A.U.R.A APIs, not hard-coded demo data.
- No API call is made in a tight loop.
- No active recon action starts without explicit authorization.
