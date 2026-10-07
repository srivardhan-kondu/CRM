# UI system

Calm, information-dense, premium B2B (PRD §8). Desktop-first for staff, responsive to phone width.

## Tokens — `src/app/globals.css`

Semantic tokens defined as CSS variables (OKLCH) for light and `.dark`, exposed to Tailwind 4 via `@theme inline`.
Components use semantic names only: `bg-surface`, `bg-surface-muted`, `text-muted`, `text-subtle`,
`border-border`, `bg-brand`, `bg-{success|warning|danger|info}-soft`, `text-*-soft-foreground`.

- **Color:** neutral base, one brand indigo, semantic green/amber/red, info blue.
- **Type:** Inter/Aptos-like system stack; `.tabular` for numbers; `text-2xs` (11px) for metadata.
- **Radius:** sm 6 · md 8 · lg 12 · xl 16. **Shadow:** xs/sm/md/lg tuned per theme.
- **Motion:** fade, scale-in, slide-in; disabled under `prefers-reduced-motion`.
- **Theme:** light / dark / system, stored per browser; applied before paint by an inline script.

## Primitives — `src/components/ui`

`Button` (primary/secondary/ghost/subtle/danger/link; sm/md/lg/icon) · `Badge` (tones) · `Card` family ·
`Input` / `Select` / `Label` · `Dialog` and `SheetContent` (side drawer) on Radix Dialog · `DropdownMenu` ·
`Tooltip` · `Skeleton`, `Kbd`, `Separator`, `Avatar`, `Meter`.

## Patterns — `src/components/patterns`

| Pattern                      | Rule                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader` + `Breadcrumbs` | Title, description, primary action; breadcrumbs preserve context.                                                                 |
| `InsightCard`                | Metric + context + **definition** + drill-down link. No metric without a definition.                                              |
| Status badges                | Text + icon + colour — never colour alone (tested).                                                                               |
| `EmptyState`                 | Explains why it's empty and offers the next action.                                                                               |
| `PermissionState`            | Doesn't reveal counts or existence of hidden data.                                                                                |
| `PhaseNote` / planned page   | Unbuilt actions are disabled and say which phase delivers them.                                                                   |
| `Timeline`                   | Unified, newest-first, iconised by domain.                                                                                        |
| Smart table                  | Server pagination/sort/filter via URL, sticky header, saved views, bulk bar on selection, keyboard row open, side-drawer preview. |
| Command palette              | ⌘K / Ctrl K / `/`; scoped student search + navigation + account actions.                                                          |

## Shell

Left rail (role workspace, grouped, phase markers, unread badges) · top bar (search/palette, campus & AY
context, approvals, notifications, theme, account) · mobile drawer navigation below `lg`.

## Accessibility baseline

Semantic landmarks, `aria-current` for nav, `aria-sort` on sortable headers, `role="meter"` with values,
visible focus rings, labelled icon buttons, Radix-managed focus trapping in dialogs, reduced motion.
