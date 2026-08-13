# Ambient Project Panel design system

## Product context

Ambient Project Layer quietly captures meaningful project events from Codex and projects them into Plane. The MCP App panel is inline-first: users should understand project health, scan recent work items, and make a lightweight status change without leaving the conversation.

## Primary design source

Use Plane's open-source design language as the target source. The screenshot supplied by the user validates the current Kanban composition, while Plane's own source defines tokens and component behavior.

Plane source findings:

- Semantic surface hierarchy: canvas, surface-1/2, layer-1/2/3.
- Semantic text hierarchy: primary, secondary, tertiary, placeholder, disabled.
- Semantic borders: subtle, subtle-1, strong, strong-1, accent-strong.
- Kanban columns use bg-layer-1, rounded-md, p-2, 8px gaps, and fixed 350px desktop width.
- Kanban cards use bg-layer-2, rounded-lg, subtle border, p-3, 13px text, raised-100 shadow, stronger border and raised-200 shadow on hover.
- Group headers use 13px medium secondary text and 11px tertiary counts.
- Drag-and-drop uses the Atlassian pragmatic drag-and-drop adapter, full-card drag targets, reduced opacity while dragging, and an accent 2px drop indicator.
- Plane supports explicit drag permission checks and visible failure feedback.

## Plane-aligned tokens

Use Inter Variable/system sans for headings and body; IBM Plex Mono only for code. Core UI sizes are 11, 12, 13, and 14px with weights 400, 500, and 600. Use 1px borders and restrained raised shadows:

- raised-100: 0 1px 6px -1px #292f3d08, 0 1px 4px #292f3d0a
- raised-200: 0 1px 2px -1px #292f3d0f, 0 1px 3px #292f3d0d
- Accent uses Plane brand semantic tokens; status colors remain the project's actual state colors.

Do not hardcode a screenshot-sampled palette when a Plane semantic token exists. Implement equivalent local CSS variables for canvas, surface, layer, border, text, accent, success, warning, and danger.

## Inline-card adaptation

Preserve four workflow states: Captured/Backlog, Planned/Todo, In progress, and Done. Compress Plane's board instead of embedding its whole application shell.

- Wide inline: keep an always-visible four-state summary/drop rail above a compact vertical work-item list. Do not render four Kanban columns.
- Medium: keep the same vertical list and fit the persistent four-state rail into one compact row.
- Narrow/mobile: keep the vertical list and wrap the persistent state rail into a 2x2 grid; the status chip/menu remains an equivalent operation and there is no internal horizontal scrolling.
- Place an `全部` selector above the four-state rail. It spans the full rail width, is 32px high, centers its label and total count inline, and leaves an 8px vertical gap before the state row. `全部` shows every relevant card; clicking a state shows only cards currently in that state.
- Limit the inline payload to 3-5 relevant items total.
- Done normally shows a count plus at most one recent item.
- No sidebar, analytics, display controls, item creation, nested scrolling, tabs, or full detail form inline.

## Interaction

- Dragging a work-item card into one of the four persistent state targets is a direct edit, not a CTA.
- The four-state rail belongs to the list region, remains visible before dragging, and stays separate from the card being dragged.
- The four state targets are dual-purpose controls: click to filter the visible list, or receive a dragged card to change its status. The `全部` control is filter-only and never accepts drops.
- Each state target shows its current item count; a successful drop updates both the card status chip and affected counts.
- After a drop, reapply the active view: in `全部` the card remains visible; in a state-filtered view a card moved out of that state leaves the list after its local update.
- Persist on drop; show local pending/saved feedback. On failure, restore the original lane and show the specific error.
- Provide a click/tap status menu and keyboard operation as the accessible fallback.
- Use one primary CTA at the bottom: 在 Plane 中打开 ↗. It opens the current Plane project or Work items page.
- Full editing, advanced/custom filters, long history, creation, merge, archive, delete, and project administration belong in Plane. Do not create an Ambient fullscreen or standalone full-board surface.

## Motion

Use restrained functional transitions only: 120-180ms ease-out for lift, target highlight, drop indicator, and placement. Respect reduced motion.

## Loading state

The approved loading treatment is [Ambient Project Inline - Skeleton Loading State](https://p.superdesign.dev/draft/bcc6772c-84fb-4894-92c9-f15279fac4e1), draft ID `bcc6772c-84fb-4894-92c9-f15279fac4e1`.

- Loading is a temporary state of the final Inline card, not a separate centered status page.
- Preserve the final responsive `width: 100%`, `max-width: 720px`, shell, header, 32px full-width `全部` control, four-state rail, list summary, five 68px work-item rows, and footer footprint.
- Use low-contrast skeletons for unknown project names, sync state, counts, and work-item content. Never display guessed values or counts derived from the five-item subset.
- The footer is a non-interactive button skeleton until the Plane project URL is available; do not render a fake CTA.
- Remove the large `Loading project panel…` card and `AMBIENT PROJECT LAYER` eyebrow.
- Use a restrained 1.2-1.6s shimmer or pulse and disable it under `prefers-reduced-motion`.
- Do not introduce loading actions, nested scrolling, or a second product surface.

## Approved final UI

The final approved normal-state visual and interaction baseline is [Ambient Project Inline A](https://p.superdesign.dev/draft/2f45e055-ac0d-4035-b761-ce539f0229de), draft ID `2f45e055-ac0d-4035-b761-ce539f0229de`. Earlier Superdesign branches are exploration history and must not be used as implementation references when they conflict with this draft or the approved loading treatment above.

The approved `全部` control is a full-width 32px row aligned to the combined width of the four equal state controls below it. Preserve all filtering, drag-and-drop, status-menu, count, feedback, and Plane CTA interactions demonstrated by the prototype. The hosted prototype is a design reference, not a production runtime dependency.

## Current implementation baseline

The current production panel is a warm beige, desktop-only, three-column master/detail shell. Its exact source is apps/panel/src/main.tsx plus apps/panel/src/styles.css. These files are the ground truth for the mandatory reproduction; this document defines the Plane-based redesign direction.
