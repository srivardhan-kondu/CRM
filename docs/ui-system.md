# UI system

"The operating system of a modern university", not another college ERP: calm, institutional, trustworthy and highly
scannable. Every screen answers three questions — what is happening, what needs attention, what should I do next.
Designed for 14-inch laptops first, then tablet and phone.

## Built for every user, including older and occasional ones

Many users are not daily computer users. The rules that follow from that (2026-10-07):

- **Large and readable:** base text 17 px (19 px with "Use larger text" in the account menu); nothing smaller than
  ~13 px; secondary text is dark grey, not light grey; buttons and inputs are at least 40 px tall, menu rows 44 px.
- **Plain words:** "To do", "Urgent", "Overdue", "Can sit the exams", "special permission" — never SLA, condonation band,
  CIE or moderation on the main screens.
- **One thing at a time:** each home page is a sentence on how things are, a to-do list with one big button per item,
  at most four large numbers, today's classes and the latest notices. Charts, comparisons and long lists sit behind
  "Show more details", closed by default.
- **Short menus:** only what the person can use today; modules from later phases are hidden (their pages still answer
  direct links). The top bar has four things: search, "Ask a question", notifications and the account menu, which
  holds role switching, text size, light/dark and sign out.
- **Clear icons:** Phosphor duotone icons, always next to a text label.

## Tokens — `src/app/globals.css`

Semantic tokens defined as CSS variables for light (the default) and `.dark`, exposed to Tailwind 4 via `@theme inline`.
Components use semantic names only: `bg-surface`, `bg-surface-muted`, `text-muted`, `text-subtle`,
`border-border`, `bg-brand`, `bg-{success|warning|danger|info}-soft`, `text-*-soft-foreground`.

- **Color (light):** background `#F6F8FB`, surface `#FFFFFF`, text `#182230` / `#64748B`, border `#E6EAF0`, brand
  `#3157D5`, success `#168A59`, warning `#B7791F`, critical `#D64545`, info `#3B82F6`. Colour only carries meaning;
  the smallest text (`subtle`, `#6B778A`) still clears 4.5:1 on white.
- **Type:** Inter (loaded with `next/font`); `.tabular` for numbers; `text-2xs` (~13 px) for the smallest metadata.
- **Radius:** sm 6 · md 8 · lg 12 · xl 16. **Shadow:** xs/sm/md/lg tuned per theme.
- **Motion:** pages fade in over 180 ms (`animate-page-in`), hovers 120 ms; nothing else animates; all disabled
  under `prefers-reduced-motion`.
- **Theme:** light by default; dark and system are options, stored per browser and applied before paint.

## Attention model — `src/domains/insights`, `src/components/os`

Every home page follows one order: header and context selector → **campus/department/class health** (leaders and
class incharges) → **needs attention** (critical, then important) beside quick actions → **action required** →
trends → role-specific detail → announcements → recent activity. Items are ranked critical → action → important →
information (`rankAttention`), and each carries the rule that raised it and its figures. The health verdict
(`campusPulse`) judges four vitals against stated thresholds. Modules from later phases appear as dashed
`PlannedCard`s naming the phase — never as invented numbers.

| Component                    | Use                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `CampusPulse`                | One verdict sentence plus four vitals, each with its threshold; status by icon + word. |
| `AttentionCard`              | Critical and important items, at most five, with a direct action each.                 |
| `ActionRequired`             | The things to do now, as count tiles.                                                  |
| `MetricCard`                 | One number, its meaning and its definition (tooltip). At most four per page.           |
| `TrendCard`                  | Weekly series with change on last week and the threshold line.                         |
| `StudentRiskCard`            | Students with the factors behind each flag.                                            |
| `WorkQueue`                  | Concrete tasks with state and an action.                                               |
| `AnnouncementCard`           | A notice: priority, author, freshness, what it asks of you.                            |
| `QuickAction`, `PlannedCard` | Shortcuts; later-phase modules.                                                        |
| `EmptyState` (`os`)          | Neutral "nothing here" or positive "nothing needs attention".                          |

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
| Command palette              | ⌘K / Ctrl K / `/`; students, faculty, courses, notices, departments and sections in scope; natural-language questions; actions.   |
| Ask CampusOS                 | Top-bar sheet and `/insights`: rule-based answers with supporting records, a recommendation and sources (ADR-025).                |

## Shell

Left rail with the global names (Home, Inbox, Students, Faculty, Academics, Attendance, Examinations,
Announcements, Approvals, Insights, Administration…), filtered by role and permission, with later-phase modules under
"Coming later" · top bar (search/palette, Ask CampusOS, institution and year, approvals, notifications, theme,
account) · mobile drawer below `lg`. Every route has a skeleton loading state and a recoverable error state.

## Accessibility baseline

Semantic landmarks, `aria-current` for nav, `aria-sort` on sortable headers, `role="meter"` with values,
visible focus rings, labelled icon buttons, Radix-managed focus trapping in dialogs, reduced motion.
