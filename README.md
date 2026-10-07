# CampusOS

The college operating system: one authoritative student record, one hierarchy-aware permission model, one
operational command center, and one analytics layer — for Indian higher-education institutions.

> **Status: Phase 5 — Campus Communication & Intelligence Hub.** Database-backed notices with audiences,
> approval, read and acknowledgement tracking and permission-checked attachments; personalised guardian messages with
> suggested follow-ups from attendance; an email outbox with quiet hours (recorded, not sent, until a provider is
> configured); personal notifications. Fees are still **synthetic** until Phase 7. See
> [docs/phase-status.md](docs/phase-status.md).

## Quick start

```bash
npm install
cp .env.example .env.local   # Neon URLs, BETTER_AUTH_SECRET, Google OAuth client, bootstrap admin email
npm run db:setup             # migrate + seed (idempotent)
npm run dev                  # http://localhost:3000
```

Sign in with Google using the bootstrap admin email, or, with `CAMPUSOS_DEMO_MODE=true`, pick any synthetic demo
account (Super Admin, Director, Principal, HOD, Programme Coordinator, Class Incharge, Faculty, Finance, Student,
Parent, Controller of Examinations, or a principal at a second institution). Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> for the command palette.
Google setup steps: [docs/deployment.md](docs/deployment.md).

## Scripts

| Script                    | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run dev`             | Development server                                                |
| `npm run build` / `start` | Production build / serve                                          |
| `npm run check`           | Type check + lint + unit tests                                    |
| `npm run typecheck`       | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`)               |
| `npm run lint`            | ESLint (Next core-web-vitals + TypeScript)                        |
| `npm test`                | Vitest unit tests                                                 |
| `npm run test:e2e`        | Playwright E2E (builds and serves on port 3100; desktop + mobile) |
| `npm run format`          | Prettier                                                          |
| `npm run db:*`            | drizzle-kit generate / migrate / studio (Phase 1+)                |

First E2E run: `npx playwright install chromium`. Integration and E2E suites need `TEST_DATABASE_URL`; they drop and
recreate that database every run.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 5.9 strict · Tailwind CSS 4 · Radix UI primitives ·
cmdk · Zod 4 · Drizzle ORM + Neon serverless Postgres · Better Auth (Google) · Vitest · Playwright. Rationale in
[docs/decisions.md](docs/decisions.md).

## Repository layout

```
src/
  app/                    Routes (App Router)
    (auth)/login          Sign-in
    (app)/                Authenticated shell: dashboard, students, students/[id], academics, courses, faculty,
                          my/courses, announcements, admin, planned modules
    actions/              Server actions (session)
    api/search            Permission-aware global search
  components/
    ui/                   Accessible primitives (button, badge, card, input, dialog/sheet, dropdown, tooltip…)
    patterns/             Product patterns (page header, insight card, states, status badges, timeline)
    shell/                Sidebar, top bar, command palette, mobile nav
    dashboard/ students/  Feature components
    academics/            Allocation, regulation and term controls
  domains/                Domain logic — pure query/visibility functions + server-only repositories
  lib/
    auth/                 Better Auth config, client, demo-password derivation
    authz/                Policy engine, permission catalogue, context loaders, org tree
    audit/                Audit event recording
    navigation/           Module registry and role workspaces
    demo/                 SYNTHETIC institution: seed source and in-memory twin for unit tests
  db/                     Neon + Drizzle client, schema, withTenant() (RLS)
drizzle/                  SQL migrations
scripts/                  migrate / seed
tests/unit/               Vitest (pure)
tests/integration/        Vitest against a rebuilt test database
e2e/                      Playwright
docs/                     Architecture, authorization, data model, UI system, security, status, decisions…
```

## Documentation

[Architecture](docs/architecture.md) · [Authorization](docs/authorization.md) · [Data model](docs/data-model.md) ·
[UI system](docs/ui-system.md) · [Analytics](docs/analytics.md) · [AI](docs/ai.md) ·
[Integrations](docs/integrations.md) · [Security](docs/security.md) · [Deployment](docs/deployment.md) ·
[Phase status](docs/phase-status.md) · [Decisions](docs/decisions.md)
