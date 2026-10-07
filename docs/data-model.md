# Data model

Postgres 18 on Neon via Drizzle ORM. Schema in `src/db/schema/*.ts` (camelCase in TypeScript, snake_case columns);
migrations in `drizzle/`. Every schema change follows PRD §30.2: migration → types → seed → policies → tests → docs.

## Phase 1 tables

| Table                                                 | Purpose                                                                            | Key constraints                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `tenant`                                              | Institution / group account                                                        | `slug` unique                                                                   |
| `org_unit`                                            | Hierarchy node: institution → campus → school → department → section, plus offices | `(tenant_id, code)` unique; `path` = `/root/…/self/` (checked shape); parent FK |
| `academic_year`                                       | Time dimension                                                                     | `(tenant_id, code)` unique                                                      |
| `app_user`                                            | Global identity (Better Auth "user")                                               | `email` unique                                                                  |
| `auth_session` / `auth_account` / `auth_verification` | Better Auth sessions, linked providers, verification tokens                        | session `token` unique; cascade on user delete                                  |
| `tenant_membership`                                   | User ↔ tenant, `active`/`suspended`                                                | PK `(tenant_id, user_id)`                                                       |
| `role`                                                | Per-tenant role definitions with `rank`                                            | `(tenant_id, key)` unique                                                       |
| `permission`                                          | Global permission catalogue                                                        | PK `key`                                                                        |
| `role_permission`                                     | Role → permission                                                                  | PK `(role_id, permission_key)`                                                  |
| `user_role_assignment`                                | User + role + org unit + scope mode + validity + revocation                        | `valid_to ≥ valid_from` check; partial index on active rows                     |
| `user_student_link`                                   | Login ↔ student record (`self` / `guardian`)                                       | `(tenant_id, user_id, student_number)` unique                                   |
| `audit_event`                                         | Append-only trail                                                                  | Trigger rejects UPDATE/DELETE/TRUNCATE; no FKs (outlives subjects)              |

## Phase 2 tables

All tenant-owned and under row-level security (ADR-016).

| Table                     | Purpose                                                                | Key constraints                                                         |
| ------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `academic_term`           | Odd / even / summer term inside an academic year                       | `(tenant_id, code)` unique; one `is_current` per tenant (partial index) |
| `programme`               | Degree programme of a department: B.Tech CSE, MBA                      | `(tenant_id, code)` unique; duration and semester bounds                |
| `curriculum`              | A regulation (R22, R24) of a programme: `draft` → `active` → `retired` | `(tenant, programme, code)` unique; `(id, programme_id)` unique for FK  |
| `curriculum_course`       | Course × semester × category within a regulation                       | PK `(curriculum_id, course_id)`; trigger: only drafts change            |
| `course`                  | Catalogue entry owned by a department or school; credits, L-T-P hours  | `(tenant_id, code)` unique; hour/credit checks                          |
| `batch`                   | Admission cohort pinned to one regulation of its programme             | Composite FK `(curriculum_id, programme_id)`; graduation > admission    |
| `section`                 | A batch's teaching section; PK is its `org_unit` id                    | `(batch_id, letter)` unique                                             |
| `course_offering`         | Course taught to a section in a term                                   | `(term, course, section)` unique                                        |
| `teaching_allocation`     | Faculty on an offering; removed (with reason), never deleted           | One active row per (offering, user)                                     |
| `faculty_profile`         | Employee code, designation, home department, weekly hour cap           | PK `(tenant_id, user_id)`; employee code unique per tenant              |
| `student`                 | The authoritative student record: identity, programme, batch, section  | `(tenant_id, student_number)` unique                                    |
| `guardian`                | Guardians of a student, one primary                                    | Cascade with student                                                    |
| `student_section_history` | Admission and every section move, with reason                          | One open row per student (partial unique); `ended_on ≥ started_on`      |

`user_student_link (tenant_id, student_number)` now references `student` (added `NOT VALID` so pre-Phase 2 links are
not checked at migration time; new rows are).

Migrations:

- `0000_identity_tenancy_authz.sql` — generated tables.
- `0001_audit_append_only.sql` — audit immutability trigger, validity check, path shape check, active-assignment index.
- `0002_academic_structure_students.sql` — generated Phase 2 tables.
- `0003_tenant_rls.sql` — checks, frozen-regulation trigger, `campusos_app` role and grants, RLS policies.

### Design notes

- `app_user` is global, so one person can belong to several institutions with one Google login. Everything
  authorization-relevant (membership, assignments, links) carries `tenant_id`.
- Assignments are never deleted. Revocation is a timestamp plus reason, so history is reproducible.
- Org units are effective-dated (`valid_from`/`valid_to`), and `path` makes ancestry checks a prefix test.

## Phase 3 tables

All tenant-owned and under row-level security (migrations 0004–0005).

| Table                | Purpose                                                                 | Key constraints                                            |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `attendance_policy`  | Institution threshold (default 75%)                                     | PK `tenant_id`; 50–100                                     |
| `holiday`            | Days with no teaching                                                   | `(tenant_id, date)` unique                                 |
| `timetable_slot`     | Weekly slot of an offering, effective from a date                       | Weekday 1–7; `HH:MM` times, end after start                |
| `class_session`      | One meeting, once recorded: held (with marks) or not held (with reason) | `(offering, date, starts_at)` unique; reason iff not held  |
| `attendance_record`  | A student's present/absent mark in a held session                       | PK `(session, student)`; cascade with session              |
| `student_leave`      | OD or medical leave, pending → approved / rejected / withdrawn          | Dates ordered; decided ⇔ decision time; no self-approval   |
| `attendance_request` | Correction or late submission with the proposed session (jsonb)         | One pending per session (partial unique); no self-approval |

`programme.attendance_threshold_pct` (nullable, 50–100) overrides the institution threshold. Functions (SECURITY
INVOKER, executable by `campusos_app` only): `attendance_save`, `attendance_request_decide`, `student_leave_decide`.

## Phase 4 tables

All tenant-owned and under row-level security (migrations 0008–0010).

| Table                  | Purpose                                                                 | Key constraints                                               |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `assessment_component` | A CIE component of an offering (IA-1…): open → submitted → approved     | `(offering, key)` unique; max 1–100                           |
| `assessment_mark`      | A student's marks in a component, or absent                             | PK `(component, student)`; half-mark steps; absent ⇔ no marks |
| `exam_event`           | A regular (per term) or supplementary examination                       | `(tenant, code)` unique; published ⇔ publish time             |
| `exam_schedule`        | When a course is examined in an event                                   | PK `(event, course)`                                          |
| `exam_registration`    | A student sitting a course in an event, with SEE marks and carried CIE  | `(event, student, course)` unique; marks within `see_max`     |
| `course_result`        | A published result per attempt: CIE, SEE, total, grade, points, outcome | `(student, course, term, attempt)` unique; grade in scale     |
| `condonation`          | Request to let a student in the band sit; decided by CoE / principal    | One open per (student, term); no self-approval                |
| `revaluation_request`  | Re-marking of a theory SEE script; the higher mark stands               | One live request per result                                   |

Functions: `assessment_marks_save`, `assessment_component_transition`, `exam_marks_save`, `exam_event_publish`,
`revaluation_complete`, `condonation_decide`. Past academic years and terms (2023–24 to 2025–26) now exist for
results.

## Phase 5 tables

All tenant-owned and under row-level security (migrations 0011–0012).

| Table                     | Purpose                                                                        | Key constraints                                                |
| ------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `announcement`            | A notice: rule (jsonb), target unit, content, state, author, decision          | published ⇔ publish time; no self-approval; frozen after draft |
| `announcement_attachment` | A file (≤ 2 MB, base64) served only by the download route                      | changes only while the notice is a draft                       |
| `announcement_receipt`    | One recipient: `s:` student, `g:` guardian household, `u:` staff; read / ack   | PK `(announcement, recipient_key)`; ack implies read           |
| `announcement_bookmark`   | A user's saved notices                                                         | PK `(announcement, user)`                                      |
| `guardian_message`        | A personalised message to one student's guardians; acknowledgement, reply      | reply needs an acknowledgement                                 |
| `notification_outbox`     | Every email: queued, held (quiet hours), sent, failed, suppressed (no address) | address unless suppressed; sent ⇔ sent time                    |
| `user_notification`       | A personal in-app notification (the bell)                                      | —                                                              |

Function: `announcement_transition`; triggers `announcement_freeze`, `announcement_attachment_freeze`. Primary
guardians gained synthetic email addresses (about one in eight has none).

## Still served from fixtures

Fees are a synthetic signal computed from the student number (ADR-018); attendance is recorded since Phase 3, results
since Phase 4 and notices since Phase 5. Everything is reachable only through repositories that run the policy
engine.

## Seed

`npm run db:seed` (idempotent) writes both tenants and their org trees; 14 system roles per tenant with permissions,
reconciled on every run; the academic year and terms; for the demo tenant the academic structure, 60 faculty, 488
students with guardians and admission history, and the current term's offerings and allocations
(`src/lib/demo/academics.ts`); 11 synthetic users with assignments and links; demo passwords when
`CAMPUSOS_DEMO_MODE=true`; and `CAMPUSOS_BOOTSTRAP_ADMIN_EMAIL` as Super Admin. All people are fictitious.

Phase 3 adds the policy (and the MBA 80% override), holidays, the current term's timetable (676 slots) and its
history from 6 July to the day before DEMO_NOW: ~7,000 sessions (a few not held, two never marked), ~77,000 marks, 12
leave applications and two pending attendance requests (`src/lib/demo/attendance.ts`). The history is written once.

Phase 4 adds past terms with 6,520 published results (three years), the September 2026 supplementary examinations for
every backlog (198 registrations, one paper unmarked, unpublished), the November 2026 examinations (87 papers, 2,440
registrations), the current term's 645 internal components with 2,399 IA-1 marks, and 6 condonation requests
(`src/lib/demo/results.ts`). Written once.

Phase 5 adds guardian emails where missing, 20 notices (17 published with ~5,800 receipts and synthetic reads, two
awaiting approval, one draft) with 7 generated PDF attachments, ~2,440 notice emails in the outbox, and 5 guardian
messages — the HOD's shortage messages to 3-CSE-B, the class incharge's to 3-CSE-A (now due a follow-up), and a meeting
request to the parent persona held for quiet hours (`src/lib/demo/announcements.ts`, `communication.ts`). Written once.

Re-running never overwrites what the app owns: students, published regulations, the current-term choice and
allocations are created once (an offering that ever had an allocation is left alone).

| Seeded user           | Role(s)                         | Scope                              |
| --------------------- | ------------------------------- | ---------------------------------- |
| Asha Menon            | Super Admin                     | Institution                        |
| Mr. Vikram Sethi      | Director                        | Institution                        |
| Dr. Meera Raghavan    | Principal                       | Institution                        |
| Prof. Arvind Kulkarni | HOD                             | CSE                                |
| Dr. Sunita Menon      | Programme Coordinator           | CSE                                |
| Ms. Kavya Nair        | Class Incharge; teaches CS302   | 3-CSE-A; 3-CSE-A/B via allocation  |
| Mr. Rahul Verma       | Teaches CS301 (no granted role) | 3-CSE-A, 3-CSE-B via allocation    |
| Dr. Leela Krishnan    | Controller of Examinations      | Institution                        |
| Ms. Anjali Rao        | Finance Officer                 | Institution                        |
| Siddharth Bose        | Student                         | Linked: 24CSE001 (self)            |
| Rajat Bose            | Parent                          | Linked: 24CSE001 (guardian)        |
| Dr. Rohan Iyer        | Principal                       | Northfield College (second tenant) |
