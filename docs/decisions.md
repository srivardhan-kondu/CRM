# Architecture decision records

## ADR-001 — Single Next.js app, modular by domain (2026-10-06)

Per PRD §11. Domains live in `src/domains/*` with pure logic separated from server-only repositories.

## ADR-002 — Tooling versions (2026-10-06)

Resolved from npm on 2026-10-06 and pinned with caret ranges: Next 16.3, React 19.3, Tailwind 4.3, Zod 4.6,
Drizzle ORM 0.45 / drizzle-kit 0.31, @neondatabase/serverless 1.2, Radix UI 1.7 (unified `radix-ui` package),
cmdk 1.1, Playwright 1.63, ESLint 9.

- **TypeScript pinned to 5.9**, not 7.0: 7.0 is the native-compiler rewrite and the Next.js / typescript-eslint
  toolchain support was not verified. Revisit in Phase 1.
- **Vitest 4.1** (npm resolved this rather than 5.0 given `@vitejs/plugin-react` peer ranges).
- **jsdom 26**, not 30: jsdom 30's undici requires a newer Node than the local Node 20 runtime.

## ADR-003 — Components on Radix primitives, shadcn-style, written in-repo (2026-10-06)

Accessible behaviour from Radix; styling via our tokens. Avoids a CLI-generated dependency on registry state.

## ADR-004 — Phase 0 serves synthetic fixtures behind repositories (2026-10-06)

Screens need realistic shapes before the schema exists. Fixtures are deterministic (seeded PRNG, fixed
`DEMO_NOW`) and only reachable through domain repositories, so Phase 1–2 replace the source without touching
pages. All data is synthetic and labelled.

## ADR-005 — Fee status is not an academic risk factor yet (2026-10-06)

The risk flag is visible to HOD and class incharge, who do not have finance permission (PRD §4). Including
"fee overdue" as a factor would leak finance data through the risk explanation. Phase 0 risk = attendance,
CGPA, backlogs. Phase 7 adds fee blockage as a factor that is masked (and excluded from the visible level)
for viewers without finance access.

## ADR-006 — Faculty read course-level data only (2026-10-06)

PRD effective-access table: faculty teaching DBMS cannot view "unrelated academic records". Faculty get
`basic` fields plus attendance for the courses in their teaching scope; no cohort CGPA, risk, contact or fees.

## ADR-007 — Honest planned-module pages (2026-10-06)

PRD engineering principle 14. Every nav item resolves to a real route; unbuilt modules render a page naming
the delivery phase, and unbuilt actions are disabled with a tooltip. No fake success states.

## ADR-008 — Demo session cookie (2026-10-06)

Phase 0 needs three-plus roles without an auth provider. An httpOnly cookie names a persona from an allow-list.
It is explicitly not authentication, is switchable off via `CAMPUSOS_DEMO_MODE=false`, and is removed in
Phase 1.

> ADR-008 was superseded by ADR-009 in Phase 1: the persona cookie is gone; demo personas now sign in through Better
> Auth with real sessions.

## ADR-009 — Better Auth for identity, CampusOS engine for authorization (2026-10-06)

The PRD names Auth.js. On 2026-10-06 `next-auth` v5 was still beta (5.0.0-beta.32), and Auth.js is now maintained by
the Better Auth team. Better Auth 1.7 is stable, has a first-party Drizzle adapter, stores sessions in Postgres, and
supports Google with sign-up disabled and verified-email account linking. Better Auth decides only _who_ the user is.
Every _may they_ decision goes through the CampusOS policy engine. No Better Auth organization/admin plugins are used,
because their role models are flatter than the hierarchy the PRD requires.

## ADR-010 — Global identity, tenant-scoped access (2026-10-06)

`app_user.email` is globally unique (Better Auth requirement). Tenancy lives in `tenant_membership`, and roles, links and
audit carry `tenant_id`. One Google login can serve several institutions, and suspending a membership affects only that
institution's access.

## ADR-011 — Row-Level Security deferred to Phase 2 (2026-10-06)

> Implemented in Phase 2 as ADR-016.

Phase 1 tables are identity/access tables read by the auth library (which cannot set per-request tenant settings) and by
loaders that filter `tenant_id` explicitly. RLS does not bind the table owner, and the app currently connects as the
Neon owner. RLS will be enabled in Phase 2 on tenant-owned business tables, together with a non-owner application role
and per-request `set_config('app.tenant_id')` inside transactions.

## ADR-012 — Delegation ceiling (2026-10-06)

Administrators may grant or revoke only roles whose permissions they themselves hold over that unit, never act on
themselves, and may suspend only users they fully cover. This makes privilege escalation structurally impossible
without a separate "can grant X" matrix. It requires the catalogue to be coherent. Unit tests enforce that the
principal covers every role but Super Admin, which is kept above everyone by the Super Admin-only `tenant:configure`
permission. Writing those invariants exposed two catalogue bugs, now fixed: the principal lacked `attendance:edit`, and
cohort-academic roles lacked `student.course_attendance:read`.

## ADR-013 — Isolated test database, rebuilt per run (2026-10-06)

Integration and E2E suites drop and recreate `campusos_test` on the same Neon endpoint, migrate from empty and seed. They
never touch the app database, and the reset is guarded by a name check. This also continuously tests that migrations
apply to an empty database. When Neon API access is available, this moves to a dedicated `ci` branch.

## ADR-014 — Demo personas via derived passwords (2026-10-06)

Testing every role needs more accounts than one Google login provides. Seeded synthetic users get password credentials
whose passwords are HMAC(`BETTER_AUTH_SECRET`, email). The secrets never sit in the repo, they differ per environment,
and the personas share the real session, audit and authorization path. Password sign-in is enabled only when
`CAMPUSOS_DEMO_MODE=true` and refused when `CAMPUSOS_ENV=production`.

## ADR-015 — Curriculum versioning: regulation per programme (2026-10-06)

Decided with the product owner. A programme has named regulations (R22, R24…), each a complete semester-by-semester
course list. An admission batch is pinned to one regulation for its whole programme (composite FK `batch →
curriculum(id, programme_id)` keeps it within the programme). Regulations move `draft → active → retired`; a trigger
rejects any change to an active or retired regulation's course list, so a published curriculum can never change under
a batch. Revisions start as a draft copied from an existing regulation. This matches how Indian affiliating
universities issue regulations, and avoids per-batch copies.

## ADR-016 — Row-level security through a switched application role (2026-10-06)

Supersedes the plan in ADR-011. Neon's owner role has `BYPASSRLS`, and adding a second login role would need a new
credential in every environment. Instead migration 0003 creates `campusos_app` (NOLOGIN, NOBYPASSRLS) and grants it to
the connection role. `withTenant()` (`src/db/tenant.ts`) runs every business-table query in one Neon HTTP transaction
that first calls `set_config('role', 'campusos_app', true)` and `set_config('app.tenant_id', …, true)`. Both settings
are transaction-local, and a policy on every tenant-owned business table compares `tenant_id` with the setting. A
missing tenant matches nothing. `campusos_app` can read only display columns of `app_user`, cannot read credentials,
and can only INSERT into `audit_event`. Identity and access tables stay outside RLS (the auth library and loaders read
them, filtering `tenant_id` explicitly). Migrations and the seed run as the owner.

## ADR-017 — Teaching access derives from allocation (2026-10-06)

Faculty access to a section's students no longer needs a separately granted, separately revoked role. The authz
loader turns each current-term teaching allocation into a unit-scoped assignment carrying the tenant's faculty-role
permissions and the courses taught (`src/lib/authz/teaching.ts`). The policy engine is unchanged. Allocation has its
own permission (`teaching:allocate`) and the same delegation ceiling as granting the faculty role (ADR-012), and
nobody can allocate themselves. Removing an allocation removes access on the next request. Phase 1's directly granted
persona faculty assignments are revoked by the seed with the reason "Superseded by teaching allocation (Phase 2)".
`user_role_assignment.course_codes` remains for course-scoped grants made outside an allocation.

## ADR-018 — Students in Neon; attendance, results and fees stay synthetic signals (2026-10-06)

Student identity, placement, guardians and section history are database records under RLS. The metrics that later
phases own (attendance in 3, results and credits in 4, fees in 7) are computed by `syntheticSignals()`, a deterministic
function of the student number and the section's current-term courses, and are labelled synthetic. This keeps every
screen honest about its sources without inventing tables that those phases would redesign. `fixtures.ts` remains the
in-memory twin of the seed, and a unit test plus an integration test assert that a student built from the database
equals its fixture.

## ADR-019 — Attendance rules (2026-10-06)

Decided with the product owner before Phase 3:

- **Threshold**: an institution default (75%, `attendance_policy`) that a programme may override
  (`programme.attendance_threshold_pct`; the synthetic MBA programme uses 80%). Risk, shortage filters and every
  screen use the student's programme threshold.
- **Correction window: same day.** A class can be marked or changed only on its own day, from its start time.
  Afterwards a change is an `attendance_request` — a correction, or a late submission when the class was never
  marked — that someone else with `attendance:approve` (HOD, principal) decides. Approval applies the proposed marks
  through `attendance_request_decide()`, which locks the request row, so a request cannot be applied twice.
- **Leave**: approved on-duty (OD) leave counts an absence as attended; approved medical leave removes the class from
  the denominator. Faculty marks are never rewritten — leave is applied when attendance is read (SQL `tallyQuery`,
  pure `rules.ts`), so leave approved after the class still counts, and rejecting or withdrawing it undoes nothing.
- Marks are present/absent only. A class not held is recorded with a reason and counts for nobody.
- `attendance_save()` refuses a mark for a student who was not on the section's roll that day (section history), so
  transfers keep each mark with the right class.

Totals live in `attendance_tally` (per student and offering), recomputed by `attendance_tally_refresh()` inside the
same transaction as every session save and leave approval. Aggregating all ≈77k marks per request cost ~0.3 s of
database time and saturated the demo compute under parallel load (dashboards took 5–6 s at 8 concurrent requests);
reading totals keeps that work off the read path. The integration parity test checks the totals against the pure rules.

## ADR-020 — Institution clock (2026-10-06)

Attendance rules depend on the institution's local day, not the server's. Calendar logic is pure and takes "now"
(`domains/attendance/calendar.ts`, Asia/Kolkata). `institutionNow()` (`lib/clock.ts`) supplies it: real time in a
normal deployment, and `DEMO_NOW` (Tue 6 Oct 2026, 09:30 IST) in demo mode, so the synthetic institution's seeded
calendar stays coherent on any real day. Business timestamps (marked, requested, decided) use the institution clock;
audit events always carry real database time.

## ADR-021 — Assessment, grading, eligibility and revaluation (2026-10-06)

The owner asked for sensible defaults (the deployment is demo-only); these follow common Indian autonomous-college
regulations and live in one pure module, `domains/exams/rules.ts`:

- **Split by course type**: theory CIE 40 (IA-1 15, IA-2 15, assignments 10) + SEE 60; lab CIE 50 (continuous 30,
  lab test 20) + external practical 50; project CIE 40 (two reviews of 20) + viva 60.
- **Pass**: at least 35% of the SEE maximum and 40% of the course total. **Grades** are absolute on a 10-point
  scale (O ≥ 90, A+ ≥ 80, A ≥ 70, B+ ≥ 60, B ≥ 50, C ≥ 45, P ≥ 40, else F; Ab when absent). SGPA is credit-weighted
  over the term's first attempts; CGPA counts each course's latest attempt, with backlogs at 0 until cleared.
- **Eligibility** from overall attendance: at or above the programme threshold, eligible; up to 10 points below, only
  with a condonation decided by the Controller of Examinations or the principal; below that, not eligible (recorded
  as "not eligible" when results are published).
- **Revaluation**: theory SEE scripts, within 7 days of publication, latest attempt only; the higher of the two marks
  stands.
- **Workflow**: teachers enter and submit each CIE component; the HOD approves (locking it) or returns it with a note;
  nobody moderates their own marks. The exam cell enters SEE marks after each paper is held and publishes an event
  once every component is approved and every sitting candidate has a mark. Publishing grades every registration into
  `course_result` in one transaction with the status change; a supplementary sitting carries CIE over and is the next
  attempt.

Each transition is a database function that locks and re-checks its row, so a second decision fails (55000).

## ADR-022 — Results replace synthetic academics (2026-10-06)

CGPA, credits earned, credits required and backlogs on every student now come from published `course_result` rows
(credits required: the sum over the student's regulation). The bundle computes standing in SQL (latest attempt per
course, then sums) rather than transferring every result: pulling all ~6,500 rows per request slowed tenant-wide pages
under parallel load. `lib/demo/results.ts` generates three years of history once for the seed and the in-memory twin;
the parity tests compare the two. Only fees remain synthetic (Phase 7).

## ADR-023 — Communication policy (2026-10-06)

The Phase 5 prerequisites were the owner's to decide; as in Phase 4, the owner left them to Claude for the synthetic
demo. Chosen defaults, all in pure modules so they are easy to change:

- **Channels**: in-app for everyone (inbox, bell, dashboards, guardian Messages). Email is the one external channel,
  queued in `notification_outbox` in the same transaction as the notice or message. Until a provider is configured the
  dispatcher uses a **log transport** that records messages as sent without delivering them; SMS, WhatsApp and push
  plug in at the same seam (Phase 11). Notice emails carry the summary and a link, not the full text.
- **Who may address guardians**: a new permission, `guardian:message` — class incharges (their section), HODs (their
  department), the principal and director. It governs both personal messages and notices whose audience includes
  guardians. Faculty and the exam cell write to students.
- **Quiet hours**: 21:00–07:00 institution time for email that is not critical; such messages are held and leave at
  07:00. In-app delivery is immediate. Critical notices bypass quiet hours.
- **Approval** (`publishRoute`): you may only target a unit where you hold `announcement:publish`. Holders of the new
  `announcement:approve` (director, principal, dean, HOD) over the target publish directly, as does anyone writing to a
  single section. Anything broader goes to someone else holding `announcement:approve` over the target; the database
  rejects self-approval and a second decision. Critical notices come only from approvers — an emergency cannot wait
  in a queue.
- **Acknowledgement and reminders**: authors may ask for acknowledgement; author and approvers see reads and
  acknowledgements per section and may email a reminder to those pending once every 24 hours.

## ADR-024 — Notices resolve recipients at publication (2026-10-06)

Visibility stays rule-based (a student who moves section sees the new section's live notices), but publishing writes
one receipt per targeted student and guardian household. That snapshot is what reach, read and acknowledgement rates
are measured against, and what reminders and emails go to; an institution-wide family notice is ~1,000 rows. Staff
receipts are created when a staff recipient first opens or acknowledges a notice, since staff audiences derive from
assignments (including teaching allocations) that are expensive to enumerate. Guardians are receipted per household
(`g:<student>`), so any linked guardian acknowledges for it. Published notices and their attachments are frozen by
trigger: a correction is a withdrawal plus a new notice, so what an approver approved is exactly what recipients got.
Attachments are stored in the row (≤ 2 MB, type verified by content) and served only by a route that re-checks
visibility, so there is no URL to leak; object storage can replace the column without changing the route.

## ADR-025 — Redesign around an attention model; a rule-based assistant (2026-10-07)

The owner asked for the interface to feel like a university operating system rather than an ERP: one purpose per
page, actionable insight over raw numbers, and a principal able to read campus health in ten seconds. Home pages now
share one structure (ui-system.md) built on a pure attention model (`domains/insights/attention.ts`): items ranked
critical → action → important → information, a health verdict judged against stated thresholds, and every item
carrying the rule and figures behind it. Weekly attendance trends sum a per-section, per-week table cached for ten
minutes, so the expensive aggregation (ADR-019) runs once per tenant rather than per request.

"Ask CampusOS" is rule-based by the owner's choice: questions are matched to intents (`domains/assistant/intents.ts`)
and answered by the same repositories the pages use, so an answer can never show more than the linked page would.
Each answer returns the sentence, supporting records, a recommended action, sources and its scope. No data leaves
the application and there is no per-use cost. A language model can be added later behind the same interface and the
same permission checks (Phase 10).

Modules from later phases (placements, fees, assignments, documents, mentoring) appear only as labelled placeholders
— the owner's choice — so no dashboard shows invented figures. Notices gained scheduled publishing (the schedule is
frozen with the content and honoured by `announcement_transition`) and two targets: a campus (its departments
resolved when written) and staff holding a role within a unit.
