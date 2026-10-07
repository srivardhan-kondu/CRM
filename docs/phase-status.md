# Phase status

| Phase | Scope                                          | Status                                                 |
| ----- | ---------------------------------------------- | ------------------------------------------------------ |
| 0     | Product foundation & design system             | **Complete** (2026-10-06)                              |
| 1     | Identity, tenancy & authorization kernel       | **Complete** (2026-10-06) — Google credentials pending |
| 2     | Academic structure & Student 360 kernel        | **Complete** (2026-10-06) — DB-verified                |
| 3     | Attendance & class operations                  | **Complete** (2026-10-06)                              |
| 4     | Assessment, examinations & results             | **Complete** (2026-10-06)                              |
| 5     | Campus Communication & Intelligence Hub        | **Complete** (2026-10-06)                              |
| 6     | Mentoring, interventions & student success     | Next                                                   |
| 7     | Finance, documents & requests                  | Planned                                                |
| 8     | Placements, internships & career intelligence  | Planned                                                |
| 9     | Executive analytics, reports & accreditation   | Planned                                                |
| 10    | AI copilot & intelligence layer                | Planned                                                |
| 11    | Integrations, hardening & production readiness | Planned                                                |

## Interface redesign (2026-10-07)

The UI now follows the attention model and visual system in ui-system.md (ADR-025): new palette and Inter, light by
default; role home pages (principal, director, HOD, class incharge, faculty, student, guardian, exam cell) that lead
with health and what needs attention; global navigation names by role; search across students, faculty, courses,
notices and units with natural-language questions; **Ask CampusOS** (rule-based, permission-safe); a Campus Inbox with
All / Important / Exams / Placements / Academic / Administrative / Saved / History; scheduled publishing and campus and
staff-role targeting (migration 0013); Student 360 in tabs with a rule-based record summary; a weekly timetable for
students and guardians; loading states throughout. Tests: 162 unit, 45 integration, E2E `redesign.spec.ts` (9 flows)
plus the earlier phases.

## Phase 5 — Campus Communication & Intelligence Hub

Policy chosen by Claude with the owner's standing go-ahead for the demo (ADR-023): in-app delivery for everyone and
email through an outbox (log transport — nothing leaves until a provider is configured); class incharges, HODs and the
principal message guardians; quiet hours 21:00–07:00 for non-critical email; section notices and approvers' notices
publish directly, broader ones from anyone else wait for an approver over that audience.

### Delivered

- **Schema** (7 tables, migrations 0011–0012, under RLS): notices with a state machine in the database
  (`announcement_transition()`: nobody approves their own notice, a notice is decided once), content and attachments
  frozen once a notice leaves draft, recipients resolved at publication, bookmarks, guardian messages, the notification
  outbox and personal notifications.
- **Announcements in Neon**: the fixtures are now seed data. Audiences target the institution, a department, a
  department year or a section, and choose students, guardians, families, staff or everyone. Staff see notices aimed
  inside their scope ("in your scope") but are only _addressed_ by staff notices.
- **Composer**: targets limited to where you may publish, live reach (students, guardian households, households
  without email), and the route explained before sending (publishes now / goes to an approver / not allowed and why).
  Drafts, attachments (PDF, image, Word, Excel; ≤ 3 × 2 MB; type checked by content), deadline, expiry,
  acknowledgement and email.
- **Approvals**: notices awaiting approval in the Approvals queue and the shell's approvals menu; approve and publish,
  or return with a note the author sees (and is notified of); recall, reopen, edit and resubmit.
- **Reading**: unread state, acknowledge, save, permission-checked attachment downloads (`/api/announcements/…`,
  always `attachment`, sandboxed, audited), Today = addressed and new, due soon, critical or awaiting your
  acknowledgement.
- **Reach & responses** (author and approvers): students and guardians read / acknowledged, by section, who is yet to
  acknowledge, email status; remind those pending by email (once a day); withdraw with a reason (unsent email
  cancelled).
- **Parent communication**: suggested follow-ups from attendance (below the requirement and not told in 14 days, with
  the rule and figures shown), per-student personalised templates with preview, sent log with read / acknowledged /
  replied and email state. Guardians read, acknowledge and reply once under **Messages**; Student 360 shows a
  student's guardian communication.
- **Notification layer**: the outbox with quiet hours, suppressed rows for missing addresses, a dispatcher
  (`/api/cron/notifications` with `CRON_SECRET`, or "Release due now" for the platform admin), and the **Delivery log**.
  Personal notifications in the bell for decisions on your leave, attendance requests, marks, condonation,
  revaluation and notices, and for guardian replies.
- **Tests**: 149 unit (policy, guards against seeded roles, quiet hours, attachment checks, templates, suggestions,
  visibility), 44 integration (RLS, self-approval, double decision, freeze, withdrawal, held-then-released email,
  reply-needs-acknowledgement), E2E `phase5.spec.ts` (9 flows).

### Exit criteria

| Criterion                                                | Evidence                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Notices reach exactly their audience                     | Visibility unit tests (department, section, year, guardians vs students); E2E 404 on file |
| Broad notices are approved by someone else, once         | `publishRoute` tests; DB 42501 / 55000; E2E HOD returns, principal approves               |
| What was sent never changes                              | Freeze trigger on notices and attachments (integration)                                   |
| Reads and acknowledgements are measured per recipient    | Receipts fanned out at publication; E2E student acknowledges; engagement panel            |
| Guardians are messaged only by those allowed, personally | `guardian:message` guard tests; per-student rendering; E2E send → parent replies          |
| External messages respect quiet hours                    | `deliverAt` tests; integration: held at 06:00, sent at 09:30                              |
| Every communication action is audited                    | `announcement.*`, `guardian_message.*`, `notification.dispatch` (security.md)             |

### Not in Phase 5

A real email provider, SMS, WhatsApp and push (Phase 11 — the outbox is the seam); per-user notification
preferences; two-way threads beyond one guardian reply; scheduled publication; notices to arbitrary student lists
(guardian messages cover individuals); campus- or school-level targets; AI drafting and summaries (Phase 10).

## Phase 4 — assessment, examinations & results

Policy chosen with the owner's go-ahead (demo deployment, ADR-021): CIE/SEE split by course type, a pass at 35% SEE
and 40% overall, absolute 10-point grades, eligibility from attendance with a 10-point condonation band, and revaluation
of theory scripts within 7 days where the higher mark stands.

### Delivered

- **Schema** (8 tables, migrations 0008–0010, under RLS) with database functions for every transition: save marks
  (open components only, within the maximum, section students only), submit (only when complete), approve or return
  (never your own), enter SEE marks (scheduled events only), publish once, decide condonation, complete revaluation.
- **Internal marks**: the teacher's courses with component status; a mark sheet per component (half marks, absent,
  live range check, other components shown alongside); submit to the HOD; the HOD's moderation queue and department
  progress; returned marks show the note.
- **Examinations** (Controller of Examinations, principal): events with progress; per-paper SEE mark sheets after the
  paper is held, with ineligible candidates locked; publish with explicit blockers; eligibility counts; condonation
  queue; revaluation queue.
- **Students and guardians**: My Exams (eligibility banner, hall-ticket timetable, supplementary sittings), My
  Academics (semester results with SGPA, CGPA, credits, backlogs, retakes, revaluation requests).
- **Everywhere else**: CGPA, credits and backlogs on every screen and in risk come from published results; Student 360
  shows results by semester; class incharges request condonation from the section attendance page; a new
  "examinations" workspace and a Controller of Examinations persona (Dr. Leela Krishnan).
- **Synthetic data**: past terms from 2023–24 with 6,520 results; September supplementary (198 registrations, one paper
  left to enter); November regular timetable (87 papers, no section with two papers in a sitting) and 2,440
  registrations; 645 CIE components (IA-1 approved almost everywhere; one submitted, one in progress); 6 condonations.
- **Tests**: 124 unit, 36 integration (RLS, the marks state machine, double publish, condonation self-approval, DB
  standing ≡ pure rules), E2E `phase4.spec.ts` (7 flows).

### Exit criteria

| Criterion                                        | Evidence                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Marks are entered by the teacher, moderated once | Guards + DB transitions; integration: incomplete submit, self-moderation, double approval fail   |
| Results follow the published rules               | `rules.ts` unit tests; every seeded result re-graded in tests; publish grades in one transaction |
| Eligibility follows attendance and condonation   | Unit (bands); E2E: CoE condones; ineligible candidates locked on mark sheets                     |
| Revaluation can only raise a mark, within 7 days | Unit; E2E: student requests, CoE records 36 → shows "was 31"                                     |
| CGPA everywhere comes from results               | Student bundle standing in SQL; parity tests DB ≡ twin                                           |

### Not in Phase 4

Exam registration for future terms in the app (seeded), seating and invigilation, question papers, grace marks,
moderation of SEE marks, grade-card PDFs, and fee-linked hall tickets (Phase 7).

## Phase 3 — attendance & class operations

Policy decided with the product owner (ADR-019): threshold per programme with a 75% institution default; marking and
changes only on the class's own day, then an approved request; approved OD counts as present, approved medical leave is
excused.

### Delivered

- **Schema** (8 tables, migrations 0004–0007, all under RLS): attendance policy and programme overrides, holidays,
  timetable slots, class sessions, attendance records, student leave, attendance requests, and maintained totals.
  Database functions save a session (refusing marks for students not on the roll that day), decide a request or leave
  under a row lock (a second decision fails), and refresh totals in the same transaction. Self-approval is rejected by a
  check constraint as well as the service.
- **Rules** (`domains/attendance/rules.ts`, `calendar.ts`, `schedule.ts`): pure and unit-tested; the institution clock
  (ADR-020) makes demo mode live at Tue 6 Oct 2026, 09:30 IST.
- **Attendance**: today's classes with "Mark attendance" once a class starts; the marking screen (accessible
  present/absent per student, all present/absent, search, leave chips, "class not held" with reason); after the day
  the same screen sends a correction or late submission; section analytics (students × courses, marking gaps, register);
  institution and programme thresholds; declaring a holiday.
- **Approvals**: queue with 48 h (requests) / 24 h (leave) SLAs, mark-level diffs, approve, reject with a note,
  withdraw; your requests; recently decided. Replaces the synthetic approvals fixture.
- **Tasks**: classes to mark now, classes not marked on the day, late submissions awaiting approval, decisions waiting.
- **My Attendance** (students and guardians): subject projections with OD/excused counts, the class-by-class register,
  leave applications (apply, withdraw).
- **Everywhere else**: Student 360, dashboards, directory, risk and course rosters use recorded attendance and the
  programme threshold; dashboards and the shell show the real timetable and approvals; sidebar badges for approvals
  and tasks. The synthetic timetable and approvals fixtures are gone.
- **Synthetic data**: 676 timetable slots; 6,989 sessions from 6 Jul to 5 Oct (83 not held, two never marked);
  76,840 marks; 12 leave applications (approved OD and medical, one rejected, two pending); two pending requests.
- **Tests**: 109 unit, 32 integration (RLS on the new tables, roll check, double decision, self-approval, leave changing
  totals, DB totals ≡ pure rules for sampled students), E2E `phase3.spec.ts` (7 flows).

### Exit criteria

| Criterion                                       | Evidence                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Teachers mark only their classes, on the day    | Guards + unit tests; E2E: marking opens at the class start; student gets 404 on the URL |
| Later changes are approved by someone else      | Requests + `attendance_request_decide()`; E2E correction approved / rejected with note  |
| Leave changes how attendance counts, as decided | `rules.ts` ≡ SQL totals (integration parity); E2E medical leave approved → "Excused"    |
| Shortage uses the programme threshold           | MBA at 80%; unit test on the shortage filter                                            |
| Every attendance change is audited              | `attendance.*`, `leave.*`, `holiday.declare`, threshold updates (security.md)           |

### Not in Phase 3

Extra (unscheduled) classes, timetable editing in the app (timetables are seeded), substitution scheduling, faculty
leave, attendance exports, notifications to guardians (Phase 5), condonation of shortage, and biometric/QR capture
(Phase 11 integrations).

### Phase 2 verification (2026-10-06)

Migrations 0002–0003 were applied with the owner's go-ahead, and verification found and fixed three Phase 2 defects:
the guardian on a student carried raw database fields; a teacher's default workspace depended on random section ids
(teaching assignments are now ordered by section code); and success toasts were lost when the control that triggered
them unmounted on revalidation (removing a teacher, revoking access) — `useResultAction` now toasts from the action
itself. The demo login page also crashed on the teaching-only Faculty persona.

## Phase 2 — academic structure & Student 360 kernel

### Delivered

- **Schema** (13 tables, migrations 0002–0003): academic terms, programmes, regulations (curricula) and their
  semester course lists, course catalogue, batches, sections (one per section `org_unit`), course offerings, teaching
  allocations, faculty profiles, students, guardians, section history. Integrity checks plus a trigger that freezes
  published regulations.
- **Row-level security** on every tenant-owned business table through the `campusos_app` role (ADR-016).
- **Students in Neon**: the directory, Student 360, dashboards, search and announcements' linked students read the
  database under RLS, with a scope prefilter in SQL and the policy engine per row. User → student links now have a
  foreign key.
- **Teaching access from allocation** (ADR-017): faculty see a section's students for the courses they teach this
  term, and lose that access when the allocation is removed.
- **Academics** module: programme overview, regulations semester by semester, draft → publish → retire, new
  regulation from an existing one, add/remove courses on drafts, term list, set current term, generate a term's
  offerings from each batch's regulation (with the count shown before you confirm).
- **Courses**: offerings by section with allocate/remove (load shown per candidate), unallocated gaps, catalogue,
  new course.
- **Faculty**: load against weekly cap by department, profile with teaching list.
- **My Courses**: a faculty member's offerings and course roster with course attendance and shortage projection.
- **Student 360**: programme, regulation, batch, this term's courses and teachers, section history, all guardians;
  edit record and move section (same batch, reason required) for `student:manage`.
- **Shell**: institution, academic year and current term from the database.
- **Synthetic data**: 6 programmes, 11 regulations (incl. a B.Tech CSE R26 draft), 173 courses, 20 batches, 44
  sections, 488 students, 60 faculty, 220 current-term offerings with 3 deliberate gaps; every faculty member is within
  their weekly cap.
- **Tests**: 88 unit (planner, allocation guards and ceiling, teaching derivation, scope prefilter, data integrity,
  DB↔fixture parity); integration suite extended with RLS isolation, frozen regulations, loaders, allocation-driven
  access; E2E `phase2.spec.ts`.

### Exit criteria

| Criterion                                                    | Evidence                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| One authoritative student record                             | `student` table under RLS; every student screen reads it; fixture parity tests                       |
| Hierarchy and academic structure agree                       | A section is an `org_unit`; batches pin regulations within their programme (composite FK)            |
| Tenant isolation enforced by the database as well as the app | RLS policies; integration tests: wrong tenant → 0 rows, no tenant → 0 rows, cross-tenant write fails |
| Teaching access follows allocation                           | Integration + E2E: remove allocation → access gone next request; re-allocate → restored              |
| Every structural change is audited                           | `course.create`, `regulation.*`, `term.set_current`, `offering.generate`, `teaching.*`, `student.*`  |

## Phase 1 exit criteria

| Criterion                                          | Evidence                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every protected server action is authorized        | Server actions re-authenticate (`currentAuth`) and call domain services that apply the engine and delegation guards; denials are audited and explained |
| Unauthorized URLs and direct API calls fail safely | E2E: anonymous → `/login` / 401; out-of-scope Student 360 → 404; non-admins on admin pages → permission state                                          |
| Cross-tenant access tests fail closed              | Unit (engine), integration (DB loaders, forged tenant/workspace cookies), E2E (Northfield principal sees 0 students, 404s)                             |
| Audit events exist for privileged actions          | Sign-in/out, invites, grants, revokes, suspensions, session revocation, Student 360 reads, denials; DB rejects edits                                   |

## Delivered

- **Neon schema** (14 tables, 2 migrations), idempotent seed with two tenants and 11 synthetic users plus the bootstrap
  Super Admin.
- **Better Auth**: Google sign-in (provision-only, verified-email linking), database sessions, demo personas through
  the same path.
- **Policy engine**: `authorize`, per-record field access, `canViewStudent` / `canEditAttendance` /
  `canPublishAnnouncement` / `canExportStudents`, multi-role users, effective-dated assignments, linked students.
- **Every Phase 0 screen now runs on the engine**: directory, Student 360, dashboards (workspace per active role, with
  switching), announcements, search, approvals.
- **Administration**: Users & access (invite, grant with scope/courses/validity/student link, revoke with reason,
  suspend/reactivate, sign out everywhere) and the Audit log (filters, keyset pagination).
- **Workspace and institution switchers** for multi-role and multi-tenant users.
- **Tests**: 72 unit, 13 integration (fresh DB per run), 22 E2E (desktop + mobile).

## Known limitations

- **Section codes encode the year of study** (`CSE-3-A`). Batches now carry the real cohort; annual promotion
  (renaming or re-parenting sections) is an operational job for a later phase.
- No UI yet to create programmes, batches or sections, or to edit a course after creation (catalogue courses are
  shared by published regulations). There is also no bulk student import: no real sample format exists yet, and the
  demo runs on synthetic data only.
- Fees on students are a deterministic synthetic signal until Phase 7 (ADR-018).
- Pages make ~10–15 sequential Neon HTTP round trips; from a laptop far from the database region that is 1–2 s per
  page. Deploying next to the database (or batching more loads) removes most of it.
- **Google sign-in needs credentials**: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see deployment.md). The code
  path is built; it cannot be exercised end-to-end until then.
- Single Neon branch. The `main` / `staging` / `preview` / `ci` branches need Neon console or API access.
- No MFA or step-up yet (Phase 11).
- Email is recorded, not delivered, until a provider is configured (Phase 11).
- Term selection is per page (`?term=`); the shell shows the current term, which is set in Academics. Campus is
  not a separate switch: campus scoping comes from the org hierarchy.

## Phase 6 prerequisites

Mentoring decisions: who mentors whom (class incharge, assigned faculty, or a mentor pool), how often mentees meet,
which risk signals open an intervention, and who sees mentoring notes (student, guardian, HOD).
