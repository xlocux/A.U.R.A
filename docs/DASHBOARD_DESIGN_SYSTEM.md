# Dashboard Design System

## Context and goals

A.U.R.A should feel like a focused dark cloud-platform dashboard: modular, information-dense, keyboard-friendly, and optimized for recon operators who need to monitor targets, tools, logs, topology, and AI context without losing visual hierarchy.

The dashboard layer is a **skin**, not a layout engine. It must preserve existing page structure, component sizing, JavaScript behavior, and compact-density overrides. The implementation lives in `public/web/dashboard-design-system.css`, loaded after `app.css` and before script-injected feature styles.

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
- `--dash-muted`: accessible muted text for labels and secondary copy
- `--dash-border`: visible panel/control borders
- `--dash-border-soft`: low-emphasis borders

Do not remap legacy structural variables such as `--panel`, `--line`, or `--accent` inside the dashboard layer unless every affected page has been checked. Keep the visual skin local to selectors instead.

### Typography

Use `IBM Plex Sans` first, falling back to Inter and system fonts. The dashboard layer may improve font family, weight, color, and heading emphasis, but must not change line-height, font-size, textarea height, table dimensions, or other sizing rules that existing modules rely on.

### Layout

The dashboard layer must not change:

- `.workspace` padding
- `.workspace-main` layout
- `.split`, `.target-grid`, `.row`, `.row3`, `.tool-grid` grid definitions or gaps
- global button/input/select/textarea width or min-height
- table layout, column widths, or scroll heights
- responsive breakpoints already managed by `app.css` or feature modules

Visual improvements should be limited to color, border, background, shadow, focus, and contrast.

### Surfaces

Primary surfaces use glass-like dark panels with:

- tokenized border color
- subtle vertical highlight gradient
- backdrop blur where supported
- soft shadow for elevation

Do not create one-off panel colors. Use tokenized surface values.

## Component-level rules

### Page shell and navigation

Anatomy:

- Header with product name and status text.
- Horizontal tab navigation with pill-shaped active states.
- Main workspace with existing A.U.R.A layout preserved.
- Floating AI assistant remains visible as an operational companion.

States:

- Default tabs use muted text on a low-contrast dark pill.
- Hover tabs increase border contrast and text contrast.
- Active tabs use the primary gradient and glow.
- Focus-visible tabs must show a 3px outline.

Responsive behavior:

- Do not introduce new responsive layout rules in the dashboard layer unless they are scoped to a new component.
- Touch target changes must not break dense operator layouts; prefer existing compact-density rules.

### Panels

Anatomy:

- `.pane`, `.embedded-window`, `.output-window`, `.modal-card`, and `.ai-panel` may share border, background, shadow, and blur behavior.
- Headings stay compact, uppercase, and high-contrast only if the existing layout remains stable.
- Body content keeps its original spacing and grid behavior.

States:

- Default: glass surface with subtle border.
- Hover: slightly stronger border only when it does not cause layout shift.
- Loading: use clear text inside existing panel bodies.
- Error: use `.notice.error` or existing error status nodes.
- Empty: use direct text, for example `No run activity loaded.`

Do not use decorative blur or gradients that reduce text contrast.

### Forms and controls

Anatomy:

- Labels are required for all inputs and selects.
- The dashboard layer may adjust color, background, and border only.
- Existing dimensions are owned by `app.css`, `compact-density.js`, and feature modules.

States:

- Default: dark field, readable placeholder, token border.
- Focus-visible: 3px blue ring and offset.
- Disabled: visible disabled style, but no layout change.
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
- Table action: keep existing compact sizing.

States:

- Hover may brighten, but must not move, resize, or shift layout.
- Disabled reduces opacity and blocks pointer affordance.
- Focus-visible must be visible on every button.

Avoid changing global button width, margin, padding, or min-height in the dashboard skin.

### Tables

Anatomy:

- Header rows use uppercase muted labels.
- Body rows use existing spacing and column rules.
- Hover rows get a subtle primary-tinted background.
- Long values must wrap or truncate according to existing table-specific rules.

States:

- Empty tables should show an explicit empty row or adjacent notice.
- Loading tables should not appear as blank panels.
- Error states should use `.notice.error` near the table.

### Metrics and status cards

Anatomy:

- Label: muted uppercase when already supported by component markup.
- Value: high-contrast bold.
- Container: glass panel with subtle inner gradient.

Use success/warning/danger tokens only for meaningful states, not decoration.

### AI panel

The AI panel is part of the dashboard architecture, not an accessory. It should remain visually aligned with dashboard panels and must preserve run/target context messaging. Assistant and user messages use distinct tinted surfaces with readable contrast.

## Accessibility requirements and testable acceptance criteria

- Every interactive element must be reachable with keyboard navigation.
- Every interactive element must show a visible `:focus-visible` outline.
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
- Use dashboard CSS to change layout, spacing, component dimensions, table widths, or scroll heights.

Migration notes:

- Keep `app.css` as the base compatibility layer.
- Keep `compact-density.js` and feature-specific injected styles authoritative for density and page-specific layout.
- Add new dashboard visual rules to `dashboard-design-system.css` only when they are visual-only and reusable.
- Add feature-specific CSS inside the feature module when layout changes are required.
- When replacing older modules, update the loader and remove obsolete scripts so click handlers do not compete.

## QA checklist

Before merging UI changes:

- Confirm `index.html` loads `app.css` first and `dashboard-design-system.css` second.
- Confirm script-injected styles such as `compact-density.js` still load after the CSS files.
- Open Recon, Results, Topology, Logs, Guide, and Settings and confirm panels share the same glass style without shifted layouts.
- Tab through the page and confirm visible focus on tabs, buttons, inputs, selects, table actions, and AI controls.
- Confirm the Recon scan preset status uses text to explain missing API keys.
- Resize the window and confirm existing responsive behavior is unchanged.
- Enable browser reduced-motion mode and confirm transitions are effectively disabled.
- Enable high-contrast mode or emulate `prefers-contrast: more` and confirm borders/text strengthen.
- Confirm loading states do not appear as blank panels.
- Confirm error states are visible in the UI and not console-only.
- Confirm AI Agent stays visible and continues to reference current target/run context.
