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

- Targets
- Runs
- Assets
- Observations
- Review
- Graph
- Tools
- Providers
- Exports
- Memory
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

- Targets: Scope, Authorization, Imports, Policy Snapshots, Notes.
- Runs: Builder, Live Run, Jobs, Events, Artifacts.
- Assets: Domains, Services, URLs, Parameters, Technologies.
- Observations: All, DNS, HTTP, Code, Mobile, Cloud, Review.
- Review: Queue, Dismissed, Suppressions, Playbook Triggers.
- Graph: Explorer, Correlations, Paths, Saved Queries.
- Tools: Registry, Custom Manifests, Parsers, Install Checks.
- Providers: API Keys, Usage, Health, Rate Limits.
- Exports: Presets, History, Generated Files.
- Memory: Snapshots, Reasoning Notes, Decisions, Run Deltas.
- Search: Cross-Data Search, Saved Queries, Technology Impact Review.
- Settings: Environment, Appearance, AI Models, Credentials, Notifications,
  Safety, Storage.

Settings should use sub-sections/tabs from the start so future preferences do
not become a mixed control wall. Initial sections should include Environment,
Appearance, AI Agent, Credentials, and Storage. Environment setup and provider
API keys belong under Settings, not as top-level macro tabs.

Topology and graph views should be first-class visual workspaces. They should
support realtime updates, animated relationship maps, layer toggles, node
selection, graph metrics, and future drilldowns into evidence, observations,
assets, jobs, and correlation edges.

Search should be a first-class investigative workspace. It should support
cross-data queries over saved observations and assets so users can quickly find
all scanned surfaces affected by a newly disclosed technology issue or CVE.

### Environment Setup

Purpose:

- Prepare WSL/native Linux execution.
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

### AI Agent Settings

Purpose:

- Choose the AI runtime used by the floating assistant.
- Configure OpenCode, OpenRouter, or a local OpenAI-compatible model.
- Keep planning and execution model choices visible.

Key UI:

- Provider status metrics.
- Planning model selector.
- Execution model selector.
- OpenRouter free model presets loaded from provider metadata when available.
- Local endpoint and model fields for Ollama or compatible runtimes.
- Autonomy level slider.
- Save and test actions.
- Clear notice that OpenRouter API keys are stored under Settings >
  Credentials with provider `openrouter`.

### Target And Scope

Purpose:

- Create targets.
- Import and review scope.
- Store authorization records.

Key UI:

- Scope editor.
- In-scope/out-of-scope table.
- Policy snapshot panel.
- Authorization files.
- Scope import preview.
- AI scope review.

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
- Provider credentials with masked values.
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
