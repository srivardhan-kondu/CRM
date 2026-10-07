# Architecture

## Shape

One deployable Next.js application, modular inside (PRD §11). Modules become services only when scale or
operations justify it.

```
Browser ──► App Router route (Server Component)
              │  requireAuth()               ── lib/authz/context.ts
              │  domain repository(authed)   ── domains/*/repository.ts   (server-only)
              │      └─ pure query/visibility ── domains/*/query.ts, visibility.ts (unit-tested)
              │      └─ data source           ── Neon: business tables via withTenant() (RLS) │ notices, timetable: fixtures
              │  projection(fields)           ── strips fields the viewer may not read
              ▼
          Client Components only where interaction needs them (filters, table selection, drawer, palette)
```

### Layering rules

1. **Pages never touch data sources directly.** They call domain repositories, which take the authenticated context and
   apply scope on the server. Repositories cache loads per request (`React.cache`).
2. **Loaders are Next-agnostic** (`domains/*/load.ts`, `lib/authz/load.ts`): they take a database handle so integration
   tests run them against the test database. Business tables are always read through `withTenant()` (ADR-016).
3. **Pure logic is separate from server-only binding.** `query.ts` / `visibility.ts` are framework-free and
   unit-tested; `repository.ts` imports `server-only` and binds them to the data source and session.
4. **Projection before serialization.** Anything passed to a Client Component goes through a projection
   (`toStudentRow`, `visibleTimeline`) that drops fields by sensitivity class. UI hiding is never the boundary.
5. **Navigation is data.** `lib/navigation/modules.ts` registers every module with its route and delivery
   phase; role workspaces in `nav.ts` reference modules by key. Unbuilt modules resolve to an honest
   "planned" page through the `(app)/[...slug]` catch-all; real routes added later take precedence.

## Request flow examples

- **Student directory** — `searchParams` → Zod-validated `StudentQuery` (invalid values dropped) → filters on
  fields unreadable on every row are removed → `listStudents(authed, query)` authorizes each record, filters, sorts and paginates
  server-side → rows projected → client table renders, selects, previews.
- **Global search** — `GET /api/search?q=` → 401 without session → scoped search → minimal result shape.
- **Announcements** — audience rules are evaluated against the viewer's scope (`isVisibleTo`) before view
  filtering; unknown, withdrawn and out-of-audience IDs all resolve to "unavailable".

## Identity and authorization (Phase 1)

```
Request ─► Better Auth session (Postgres)            src/lib/auth/auth.ts
        ─► AuthContext: membership, assignments,      src/lib/authz/load.ts + context.ts (React cache per request)
           permissions, student links, org tree
        ─► Domain repository ─► policy engine          src/lib/authz/engine.ts (pure)
        ─► projection by field access ─► client
Mutations: server action ─► currentAuth() ─► domain service (validate + guards) ─► db.batch([change, audit])
```

- **Workspace ≠ permission.** The active assignment picks the navigation and dashboard. Data access is the union of
  all the user's active assignments, each applied only within its own scope.
- **Loaders are Next-agnostic** (`load.ts`), so the same code runs in integration tests against a real database.
- **Seed and tests share sources.** The org specs, role catalogue and personas that the seed writes are the same
  modules unit tests build in-memory contexts from.

See [authorization.md](authorization.md) for the rules and [security.md](security.md) for the audit catalogue.

## Academic structure and the student record (Phase 2)

```
programme ─< curriculum (regulation) ─< curriculum_course >─ course
    │              ▲ pinned
    └──────< batch ┘ ─< section (= org_unit) ─< student ─< guardian, student_section_history
                              │
academic_term ─< course_offering (term × course × section) ─< teaching_allocation ─► derived faculty assignment
```

- **Student read**: `studentScope(ctx)` narrows the SQL to covered sections and linked students, `loadStudents()` reads
  them under RLS and assembles the domain `Student` (current-term placement and synthetic signals), and the engine
  decides access per row.
- **Mutations** (`domains/academics/service.ts`, `domains/students/service.ts`): guard, validate, then
  `withTenant([change, audit])` in one transaction. Refusals are audited as `denied`.

## Attendance (Phase 3)

```
timetable_slot ─(expand over dates − holidays)─► expected classes ─(minus class_session)─► unmarked / tasks
class_session ─< attendance_record ──┐
student_leave (approved) ────────────┴─► tallyQuery (SQL) ≡ rules.ts (pure) ─► Student.attendancePct, subjects
attendance_request ─► attendance_request_decide() ─► attendance_save()
```

- **Reads** (`domains/attendance/repository.ts`): classes on a day, a teacher's open sessions, one session for marking,
  the approval queue, section analytics and a student's register — each limited by `guards.ts`.
- **Writes** (`service.ts`): mark (same day), request (later), decide, withdraw, leave, thresholds, holidays. Session
  saves and decisions run as database functions inside `withTenant`, together with the audit row.
- **Clock**: business rules use `institutionNow()` (ADR-020).
- **Twin**: `lib/demo/attendance.ts` generates the history once for the seed and aggregates it in memory for tests; an
  integration test asserts the SQL aggregate equals the twin for sampled students.

## Assessment and examinations (Phase 4)

```
course_offering ─< assessment_component ─< assessment_mark        (teacher enters → HOD approves → locked)
exam_event ─< exam_schedule, exam_registration (SEE marks)         (exam cell, after each paper)
           └─ publish ─► course_result (per attempt) ─► standingQuery ─► Student.cgpa / credits / backlogs
attendance ─► eligibilityFor + condonation ─► who may sit (hall ticket, "not eligible" results)
course_result ─< revaluation_request ─► higher SEE mark stands
```

Grading, eligibility and revaluation are pure (`domains/exams/rules.ts`); services grade in TypeScript and write the
results in the same transaction as `exam_event_publish()`.

## Communication Hub (Phase 5)

```
composer ─► publishRoute(rule, severity, authorityAt(unit))  ─► draft | pending (approver) | published
published ─► receipts (students, guardian households)  ─► inbox state: addressed / read / acknowledged / saved
          └─► notification_outbox (deliverAt: quiet hours) ─► dispatchDue ─► transport ("log" until Phase 11)
guardian message (per student, rendered) ─► guardian inbox + outbox + bell; acknowledge / reply ─► sender's bell
decisions in attendance, exams, notices ─► user_notification (same transaction) ─► bell
```

Policy, visibility, quiet hours, templates and suggestions are pure (`domains/announcements/rules.ts`,
`visibility.ts`, `domains/notifications/quiet-hours.ts`, `domains/messages/*`); services write the change, its
recipients, its emails and its audit event in one transaction.
