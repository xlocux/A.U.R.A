# Dashboard Design System

## Context and goals

A.U.R.A should feel like a focused dark cloud-platform dashboard: modular, information-dense, keyboard-friendly, and optimized for recon operators who need to monitor targets, tools, logs, topology, and AI context without losing visual hierarchy.

This system is implemented as a layered stylesheet in `public/web/dashboard-design-system.css`, loaded after `app.css`. Existing product behavior remains in the current JS modules; this layer standardizes visual hierarchy and interaction states without turning `app.css` into a monolith.

## Design tokens and foundations

### Token model

Use semantic CSS variables before raw values:

- `--dash-primary`: `#0C5CAB`
- `--dash-primary-600`: `#0a4a8a`
- `--dash-primary-400`: `#3b82f6`
- `--dash-success`: `#10b981`
- `--dash-warning`: `#f59e0b`
- `--dash-danger`: `#ef4444`
- `--dash-surface`: `#09090b`
- `--dash-text`: `#fafafa`
- `--dash-muted`: `#a1a1aa`
- `--dash-space-1`: `8px`
- `--dash-space-2`: `16px`
- `--dash-space-3`: `24px`
- `--dash-space-4`: `32px`

Legacy A.U.R.A variables such as `--bg`, `--panel`, `--line`, `--accent`, `--ok`, `--warn`, and `--bad` are mapped to dashboard tokens so older components continue to work.

### Typography

Use `IBM Plex Sans` first, falling back to Inter and system fonts. The scale should stay on 12/14/16/20/24/32 where possible. Component labels use 12px, uppercase section headings use 12px with 0.08em letter spacing, and metric values use responsive 18px to 28px.

### Layout

Use an 8pt spacing rhythm. Page-level spacing should use `--dash-space-2`; compact nested gaps should use `--dash-space-1`. Panels, tabs, controls, tables, and metrics must keep consistent rounded radii from `--dash-radius-sm`, `--dash-radius-md`, and `--dash-radius-lg`.

### Surfaces

Primary surfaces use glass-like dark panels with:

- 1px semantic border from `--dash-border`
- subtle vertical highlight gradient
- backdrop blur where supported
- soft shadow for elevation

Do not create one-off panel colors. Use tokenized surface variables.

## Component-level rules

### Page shell and navigation

Anatomy:

- Header with product name and right-aligned status text.
- Horizontal tab navigation with pill-shaped active states.
- Main workspace with modular panel grids.
- Floating AI assistant remains visible as an operational companion.

States:

- Default tabs use muted text on a low-contrast dark pill.
- Hover tabs increase border contrast and text contrast.
- Active tabs use the primary gradient and glow.
- Focus-visible tabs must show a 3px outline.

Responsive behavior:

- Below 1100px, header status stacks below the title and grid layouts collapse to one column.
- Touch devices must keep 44px minimum hit targets.

### Panels

Anatomy:

- `.pane`, `.embedded-window`, `.output-window`, `.modal-card`, and `.ai-panel` share border, radius, background, shadow, and blur behavior.
- Headings stay compact, uppercase, and high-contrast.
- Body content uses `.form-body`, `.scroll`, table wrappers, or purpose-specific grids.

States:

- Default: glass surface with subtle border.
- Hover: slightly stronger border.
- Loading: use a clear message inside `.notice.muted` or panel body.
- Error: use `.notice.error` or existing error status nodes.
- Empty: use direct text, for example `No run activity loaded.`

Do not use decorative blur or gradients that reduce text contrast.

### Forms and controls

Anatomy:

- Labels are required for all inputs and selects.
- Controls use dark input surfaces with visible borders and 40px minimum height.
- Touch coarse pointers increase controls to 44px.

States:

- Default: dark field, muted placeholder, token border.
- Hover: inherited platform behavior is acceptable if focus remains explicit.
- Focus-visible: 3px blue ring and offset.
- Disabled: 58% opacity and `not-allowed` cursor.
- Error: pair the invalid field with a `.notice.error` or explicit text status.

Recon-specific rule:

- The recon screen should expose `Input mode` and `Scan preset` separately.
- API-backed provider tools without an active key should be disabled and visibly annotated as needing an API key.
- The AI assistant must remain context-aware of target, run, tool, and scope state.

### Buttons

Variants:

- Primary: blue dashboard gradient.
- Danger: red gradient with red border.
- Subtab/nav: pill variant with active gradient.
- Table action: compact but still keyboard focusable.

States:

- Hover lifts by 1px and brightens.
- Active returns to baseline.
- Disabled reduces opacity and blocks pointer affordance.
- Focus-visible must be visible on every button.

Avoid text-only clickable spans; use semantic `button` elements.

### Tables

Anatomy:

- Header rows use uppercase muted labels.
- Body rows use top borders for scanability.
- Hover rows get a subtle primary-tinted background.
- Long values must wrap or truncate intentionally based on table context.

States:

- Empty tables should show an explicit empty row or adjacent notice.
- Loading tables should not appear as blank panels.
- Error states should use `.notice.error` near the table.

### Metrics and status cards

Anatomy:

- Label: uppercase muted 11px.
- Value: high-contrast 18px to 28px bold.
- Container: glass panel with subtle inner gradient.

Use success/warning/danger tokens only for meaningful states, not decoration.

### AI panel

The AI panel is part of the dashboard architecture, not an accessory. It should remain visually aligned with dashboard panels and must preserve run/target context messaging. Assistant and user messages use distinct tinted surfaces with readable contrast.

## Accessibility requirements and testable acceptance criteria

- Every interactive element must be reachable with keyboard navigation.
- Every interactive element must show a visible `:focus-visible` outline.
- Touch targets must be at least 44px when `pointer: coarse` is active.
- Text contrast must meet WCAG 2.2 AA for normal text and UI labels.
- Reduced motion must disable non-essential transitions and animations through `prefers-reduced-motion`.
- High contrast mode must strengthen borders and muted text through `prefers-contrast: more`.
- Inputs must have associated labels.
- Empty, loading, and error states must be text-visible and not color-only.
- Recon warnings about missing API keys must be visible as text, not just disabled controls.

## Content and tone standards with examples

Tone should be concise, clear, professional, and action-oriented.

Use:

- `Full provider expansion will continue without Reverse WHOIS unless an active WhoisXMLAPI key is added.`
- `Load a run from Results before opening this view.`
- `API-backed providers unavailable: add keys in Settings > API Keys.`

Avoid:

- `Oops, something went wrong.`
- `Invalid.`
- `Click here.`
- Ambiguous labels such as `Mode` when the actual choice is `Input mode` or `Scan preset`.

## Anti-patterns and prohibited implementations

Do not:

- Add new raw colors when a token exists.
- Create one-off glass panels with custom opacity values outside the token system.
- Hide errors in the browser console only.
- Use low-contrast muted text for critical instructions.
- Mix card, terminal, neon, and skeuomorphic metaphors in the same region.
- Override focus outlines without replacement.
- Add new dashboard behavior as multiple competing click handlers for the same target.
- Disable API-backed recon providers without explaining why they are disabled.

Migration notes:

- Keep `app.css` as the base compatibility layer.
- Add new global visual rules to `dashboard-design-system.css` only when they are reusable across the dashboard.
- Add feature-specific CSS inside the feature module only when it cannot reasonably be generalized.
- When replacing older modules, update the loader and remove obsolete scripts so click handlers do not compete.

## QA checklist

Before merging UI changes:

- Confirm `index.html` loads `app.css` first and `dashboard-design-system.css` second.
- Open Recon, Results, Topology, Logs, Guide, and Settings and confirm panels share the same glass style.
- Tab through the page and confirm visible focus on tabs, buttons, inputs, selects, tables actions, and AI controls.
- Confirm the Recon scan preset status uses text to explain missing API keys.
- Resize below 1100px and confirm grids collapse to one column without clipped controls.
- Enable browser reduced-motion mode and confirm transitions are effectively disabled.
- Enable high-contrast mode or emulate `prefers-contrast: more` and confirm borders/text strengthen.
- Confirm loading states do not appear as blank panels.
- Confirm error states are visible in the UI and not console-only.
- Confirm AI Agent stays visible and continues to reference current target/run context.
