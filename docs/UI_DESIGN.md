# A.U.R.A UI Design Direction

A.U.R.A is a local-first, AI-driven recon workbench. The interface should feel
like a serious operational dashboard, not a marketing site and not a novelty
"hacker" theme.

## Product Feel

```text
Local recon command center.
Quiet, dense, technical, readable.
Built for long sessions and repeated decisions.
```

Avoid:

- Neon cyberpunk styling.
- Decorative gradients or glowing orb backgrounds.
- Oversized hero sections.
- Marketing-page composition.
- Low-density card walls.
- Visual noise that competes with recon data.

## Language

All user-facing text must be in English:

- UI labels.
- Buttons.
- Empty states.
- Tooltips.
- Errors.
- Toasts.
- Event messages.
- AI chat responses.
- Generated reports.
- Docs.

This applies to all AI-generated UI copy and all future feature work unless the
user explicitly configures a different output language for a generated export.

## Layout

Use an application shell:

```text
Left navigation
  -> main workspace
  -> right AI assistant panel
```

Top-level workspace tabs:

- Recon
- Wordlists
- Search
- Topology
- Results
- Runs & Logs
- Settings

Main workspace:

- Dense tables.
- Filter bars.
- Split panes.
- Detail drawers.
- Timelines.
- Job/event logs.
- Graph and relationship views.
- Config editors.
- Dedicated tabs for major sections and sub-workflows.
- Viewport-fit desktop layouts with internal scrolling for long tables, logs,
  JSON editors, artifact lists, and chat history.

Right assistant panel:

- Context-aware AI chat.
- Current target/run context.
- Suggested next action.
- Proposed action confirmation.
- Links to evidence.
- Persistent floating desktop placement so the user can ask for help without
  leaving the current workflow tab.
- The floating assistant must behave like a small desktop window: draggable from
  its header, resizable from its corners, minimizable/restorable, persisted in
  `localStorage`, and always clamped within the visible viewport.
- User and assistant messages should use distinct colors and compact spacing so
  the chat remains readable without consuming excessive screen space.
- Global readability preferences such as font size should live in Settings and
  persist locally.

## Core Screens

Each macro section should use dedicated tabs for its major sub-workflows. Tabs
should keep related workflows in one screen while avoiding long scrolling pages
or overloaded mixed panels.

Recommended macro tab patterns:

- Recon: Target setup, Scope, Run Builder, Provider Discovery, Surface
  Discovery, Tools.
- Wordlists: Saved Lists, Generated Lists, Tool Presets.
- Search: Cross-Data Search, Saved Queries, Technology Impact Review.
- Topology: Explorer, Correlations, Paths, Saved Queries.
- Results: Explorer, Delta, Domains, Services, URLs, Parameters,
  Technologies, Screenshots, Export.
- Results table views should offer compact grouping controls for common pivots
  such as HTTP status code, technology, host, source, tool, and delta type.
  Screenshot views should render available image thumbnails instead of only
  local filesystem paths.
- Runs & Logs: Live Run, Jobs, Events, Artifacts.
- Settings: Environment, Appearance, AI Models, API Keys, Notifications,
  Safety, Proxy, Storage.

Settings should use sub-sections/tabs from the start so future preferences do
not become a mixed control wall. Initial sections should include Environment,
Appearance, AI Agent, Proxy, API Keys, and Storage. Environment setup, proxy
configuration, and provider API keys belong under Settings, not as top-level
macro tabs.

Topology and graph views should be first-class visual workspaces. They should
support realtime updates, animated relationship maps, layer toggles, node
selection, graph metrics, and future drilldowns into evidence, observations,
assets, jobs, and correlation edges.

Search should be a first-class investigative workspace. It should support
cross-data queries over saved observations and assets so users can quickly find
all scanned surfaces affected by a newly disclosed technology issue or CVE.

### Environment Setup

Purpose:

- Prepare local Linux execution.
- Bootstrap OpenCode.
- Configure model/provider.
- Check tools.

Key UI:

- Execution environment status.
- OpenCode install/check state.
- Planning model selector.
- Execution model selector.
- Tool health table.
- Install/update action for declared registry tools.
- API key setup prompt with an explicit skip path for optional providers.
- Guided setup actions.
- AI setup assistant.

### Proxy Settings

Purpose:

- Route authorized recon tool traffic through an explicit upstream proxy.
- Support Burp or other interception proxies for request analysis.
- Support controlled lab egress through user-provided `http`, `https`,
  `socks4`, or `socks5` proxy URLs.
- Allow manual import of private or otherwise authorized proxy lists for
  explicit selection.

Rules:

- Proxy settings belong under Settings, not inside individual result views.
- Proxy credentials must be redacted in UI status and run events.
- Imported proxy lists must be manually supplied by the user.

### AI Agent Settings

Purpose:

- Choose the AI runtime used by the floating assistant.
- Configure OpenCode, Codex CLI, Claude Code CLI, OpenRouter, or a direct local
  OpenAI-compatible endpoint.
- Keep planning and execution model choices visible.

Key UI:

- Provider status metrics.
- Runtime configuration panel showing OpenCode, Codex, and Claude availability,
  plus redacted OpenCode config when available.
- Explicit `Use direct local model endpoint` checkbox, unchecked by default,
  before local endpoint fields become editable.
- Planning model selector.
- Execution model selector.
- OpenRouter free model presets loaded from provider metadata when available.
- Local endpoint and model fields for Ollama or compatible runtimes.
- Autonomy level slider.
- Save and test actions.
- Clear notice that OpenRouter API keys are stored under Settings > API Keys
  with provider `openrouter`.

### Appearance Settings

Purpose:

- Let users tune the workbench for long sessions without changing the product
  language or workflow density.
- Keep visual customization local to the browser.

Key UI:

- Theme selector with operational themes such as A.U.R.A Teal, Raven Cyan,
  Ember Amber, Violet Signal, and Monochrome Ops.
- Background effect selector with a random rotation mode and explicit effects
  for waves, particles, neural links, grid pulses, flow lines, mesh fields,
  orbits, horizon scans, and prime-number drift.
- Font scale slider for global readability.

Rules:

- Themes and background effects must preserve contrast and dense dashboard
  readability.
- Background effects must stay subtle, non-blocking, and behind all functional
  UI surfaces.
- Appearance preferences should be persisted in `localStorage`.

### Target And Scope

Purpose:

- Create targets inside the Recon workflow.
- Import and review scope.
- Store authorization records.

Key UI:

- Scope editor.
- In-scope/out-of-scope table.
- Policy snapshot panel.
- Authorization files.
- Scope import preview.
- AI scope review.

### Provider And Surface Discovery

Purpose:

- Keep all discovery pivots inside Recon instead of splitting them into a
  separate asset-discovery workspace.
- Run passive provider pivots across configured sources such as WhoisXMLAPI,
  Censys, Shodan, RDAP, Rapid7, and future provider adapters.
- Treat JavaScript files, endpoints, archived URLs, parameters, SaaS providers,
  technologies, and historical data as recon surfaces rather than a separate
  top-level module.

Key UI:

- Provider source list with installed/configured/coming-soon states.
- One-click WHOIS/RDAP term suggestion that reads public registration data,
  skips private or registrar-only records, and fills editable Reverse WHOIS
  include/exclude terms.
- Search terms and exclusions for provider pivots.
- Discovery leads table with source, confidence, and matched terms.
- Links from leads to follow-up recon jobs, review items, and graph edges.

### Recon Run Builder

Purpose:

- Configure a run before execution.

Key UI:

- Profile selector: Passive, Standard, Full, Custom.
- Phase toggles.
- Tool selection.
- Rate limit controls.
- Timeout controls.
- Wordlist selection.
- Dry-run preview.
- AI-generated run config.

### Live Run

Purpose:

- Monitor and control active recon.

Key UI:

- Run status summary.
- Phase progress.
- Jobs table.
- Event timeline.
- Artifact links.
- Pause/cancel/resume controls.
- AI failure explanation.
- Visible activity feedback for every long-running action so the operator can
  tell when A.U.R.A is importing, testing, probing, installing, or refreshing.

### Assets And Observations

Purpose:

- Explore normalized recon data.

Key UI:

- Filterable tables.
- Scope status chips.
- Confidence chips.
- Source/tool badges.
- Evidence links.
- Detail drawer.
- Promote/dismiss controls.
- AI summary and triage suggestions.

### Review Items

Purpose:

- Work through human-review findings.

Key UI:

- Priority queue.
- Category filters.
- Evidence links.
- Dismiss reason selector.
- Suppression rule creation.
- AI explanation.

### Correlation Graph

Purpose:

- Traverse relationships between observations.

Key UI:

- Search node.
- Neighborhood graph.
- Edge confidence.
- Edge evidence.
- Max hop selector.
- AI path explanation.

### Tools And Providers

Purpose:

- Manage tool and provider configuration.

Key UI:

- Tool registry table.
- Built-in/custom manifest distinction.
- Version check.
- Install action.
- Parser mapping.
- Provider API keys with masked values.
- Model/provider settings.

### Memory

Purpose:

- Inspect historical reasoning and target memory.

Key UI:

- Memory snapshots.
- Reasoning notes.
- Prior decisions.
- Dismissed findings.
- Run deltas.
- AI memory search.

## Visual System

Default to dark mode.

Palette:

```text
Background: near-black graphite
Surface: dark slate
Elevated surface: slightly lighter slate
Primary accent: cyan or teal
Warning: amber
Danger: muted red
Success: green
Text primary: off-white
Text secondary: cool gray
Border: low-contrast slate
```

Use accent color sparingly for active states, focus rings, links, and primary
actions.

## Components

Use:

- Tables for dense data.
- Tabs for related views.
- Segmented controls for modes.
- Toggles for binary settings.
- Sliders/number inputs for limits.
- Menus for option sets.
- Chips for scope, confidence, status, and tags.
- Drawers for details.
- Modals for confirmations.
- Toasts for short-lived status.
- Tooltips for icons and advanced settings.

Avoid:

- Cards inside cards.
- Large rounded decorative panels.
- UI text explaining obvious controls.
- Giant hero typography inside application screens.
- Viewport-scaled font sizes.

## Status Language

Common statuses:

- `ready`
- `missing`
- `checking`
- `installing`
- `queued`
- `dispatched`
- `running`
- `succeeded`
- `failed`
- `timed out`
- `cancelled`
- `requires review`
- `dismissed`
- `suppressed`

Scope statuses:

- `in scope`
- `out of scope`
- `unknown`

Confidence:

- `high`
- `medium`
- `low`
- `unknown`

## AI Assistant UX

The AI assistant should be docked, persistent, and contextual.

It should know:

- Current page.
- Current target.
- Current run.
- Selected observation/asset/review item.
- Relevant evidence.
- User-selected autonomy level.

It should provide:

- Explanation.
- Suggested next step.
- Draft config.
- Proposed action.
- Evidence citations.

Action confirmations should be explicit:

```text
Proposed action:
Run DNS validation for 142 candidate domains.

Scope:
example.com wildcard scope only.

Limits:
Concurrency 20, timeout 120s.

Evidence:
Run 12, observations 500-642.
```

## Tables

Tables are central to A.U.R.A.

Every major data table should support:

- Search.
- Filter.
- Sort.
- Column visibility.
- Row detail drawer.
- Export selected rows.
- Evidence links.
- AI explanation for selected rows.

## Accessibility

- Maintain strong contrast.
- Do not rely on color alone.
- Use visible focus states.
- Keep font sizes stable.
- Ensure text never overflows controls.
- Provide keyboard-friendly navigation for tables and modals.

## Implementation Notes

- Use existing UI patterns before adding new abstractions.
- Prefer compact, predictable layouts.
- Use icons for common actions when available.
- Use monospace for commands, artifact paths, IDs, and raw values.
- Keep destructive actions behind confirmation.
- Never show raw secrets in UI.

## Status Badge Normalization

A.U.R.A status, severity, and health cells use the shared browser helper in `public/web/status-badges.js`.

- Use `window.AuraStatusBadges.badge(value, options)` when rendering table HTML.
- Use `window.AuraStatusBadges.applyToElement(node, value, options)` when updating an existing badge after an async action.
- Keep table-specific renderers focused on data mapping only; do not duplicate SVG markup in feature files.
- Use `{ kind: "severity" }` for run-event severity cells so `ok`, `info`, `warn`, and `error` map consistently.
- Current consumers include API keys, proxy rows, environment tool status, tool results, wordlist rows, and workspace log tables.

The shared component intentionally keeps animated SVG icons inline so the dashboard works as a static drop-in web bundle without additional icon dependencies.

### API Key Table Fit

The API key settings view uses a two-column, viewport-fit layout:

- The provider form and provider table scroll independently inside `#settings-credentials`.
- The provider table keeps its header and summary visible while long key inventories scroll inside `.api-key-table-wrap`.
- Usage cells render a compact progress meter with `apiUsageProgress(key)` so free-tier limits are visible without adding another dependency.
- Unlimited keys still show a neutral rail and explicit `used/unlimited` text.

## Tool Toggle Cards and Dialogs

Recon tool selection uses compact toggle cards instead of native checkbox rows. Each card keeps the original checkbox input in the DOM for compatibility with the recon payload and preset logic, while presenting a three-state visual model:

- `Enabled`: selected and ready to run.
- `Disabled`: available but not selected.
- `Needs API key`: locked because the provider requires an active key in Settings > API Keys.

The card layer is progressive enhancement in `public/web/tool-toggle-cards.js`; recon logic still reads the same input ids, so backend payloads and AI-aware recon planning remain unchanged.

Native browser confirmation prompts are replaced by the shared `AuraDialogs` modal helper in `public/web/aura-dialogs.js`. Destructive actions use the danger tone, keyboard focus is trapped while the dialog is open, and existing async flows wait for the modal result before mutating local recon data.

### Discovery Leads score bars and Recon scroll behavior

Discovery Leads now render correlation scores as compact progress meters rather than plain numbers. Scores are normalized to a 0-100 range and use distinct visual states: low confidence, medium confidence, high confidence, and empty/no-score. This keeps AI-assisted provider leads scannable while preserving the original lead source, status, rationale, and match terms.

The Recon tab uses a single vertical scroll container on desktop. Discovery Leads keep horizontal overflow for wide tables, but the lead table no longer creates a nested vertical scroll area; this reduces scroll jitter while preserving access to all saved observations.

Run Delta keeps its summary and metric cards in a dedicated header area above the table. Delta rows remain isolated in the table scroll area so Explorer content cannot visually bleed into the Delta view.

### Results Explorer detail fit

The Results Explorer keeps the selected-node detail pane free of a nested scrollbar on desktop. Detail sections are rendered in a compact grid and long node collections are summarized with an export hint so the recon workspace stays smooth while preserving complete data in JSON/CSV exports.

### Application-wide toggle buttons

Native checkbox chrome is hidden across the dashboard and progressively enhanced by `public/web/tool-toggle-cards.js`.

- Recon Tools keep the full card treatment with enabled, disabled, and API-key locked states.
- Compact dashboard filters, Topology layers, Settings switches, and Search scope controls use the same SVG state language in a smaller pill/button treatment.
- The original checkbox inputs stay in the DOM and continue to drive existing recon, filter, settings, and AI-aware workflows.
- Disabled API/provider controls render as locked buttons and do not trigger browser-native checkbox visuals.

Topology layer toggles rebuild the graph without calling Fit/Reset, so changing a layer no longer changes the current zoom or pan position.
