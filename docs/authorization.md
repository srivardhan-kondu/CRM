# Authorization

Model (PRD §4): **subject → role → action → resource → organisational scope → field sensitivity → context**.
Deny by default. Enforced on the server for every page, server action and route handler. Navigation and hidden
buttons are UX only.

## Layers

| Layer               | Where                                 | Responsibility                                                                                                   |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Identity            | Better Auth (`src/lib/auth/auth.ts`)  | Who the user is; database sessions; Google sign-in; no self sign-up                                              |
| Context             | `src/lib/authz/load.ts`, `context.ts` | Per request: active tenant membership, unrevoked in-date role assignments + permissions, student links, org tree |
| Policy engine       | `src/lib/authz/engine.ts` (pure)      | `authorize(ctx, tree, permission, resource)`, `studentFieldAccess`, named helpers                                |
| Domain repositories | `src/domains/*/repository.ts`         | Call the engine for every record; project fields before serialization                                            |
| Delegation guards   | `src/domains/admin/guards.ts` (pure)  | Who may grant, revoke, suspend or sign out whom                                                                  |
| Database            | Postgres constraints + triggers       | Append-only audit; coherent validity ranges; tenant-scoped uniqueness                                            |

## Data model

- **`tenant_membership`** — a user may enter a tenant only with an `active` membership. Suspension blocks
  everything and ends sessions.
- **`role` / `permission` / `role_permission`** — roles are per-tenant data; permissions are a global catalogue
  (`src/lib/authz/catalogue.ts`, written by the seed and reconciled on every seed run).
- **`user_role_assignment`** — user + role + org unit + scope mode, effective-dated (`valid_from`/`valid_to`), revoked
  rather than deleted (`revoked_at`, `revoked_by`, `revoke_reason`). One user may hold many.
- **Scope modes** — `subtree` (the unit and everything under it), `unit` (that unit only), `linked` (only students linked
  to the user via `user_student_link`: `self` for students, `guardian` for parents).
- **Teaching assignments** (Phase 2, ADR-017) — each current-term `teaching_allocation` becomes a derived, unit-scoped
  faculty assignment carrying the courses taught there (`src/lib/authz/teaching.ts`). They appear in the workspace
  switcher as "(teaching)" and end when the allocation is removed. `course_codes` on a granted assignment remains for
  course-scoped grants made outside an allocation.

## Permission catalogue

| Key                                                                                                                  | Meaning                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `student:view`                                                                                                       | Open student records in scope (row access)                                          |
| `student:export`                                                                                                     | Export lists — separate from view, audited                                          |
| `student.contact:read`, `.guardian:read`, `.academic:read`, `.course_attendance:read`, `.risk:read`, `.finance:read` | Field sensitivity classes                                                           |
| `announcement:view`, `announcement:publish`                                                                          | Read / publish within scope                                                         |
| `announcement:approve`                                                                                               | Approve others' notices for the target; publish broad and critical notices directly |
| `guardian:message`                                                                                                   | Message guardians of students in scope; address notices to guardians                |
| `approval:view`                                                                                                      | See approvals in scope                                                              |
| `attendance:edit`                                                                                                    | Mark attendance on the class's day; request corrections afterwards (Phase 3)        |
| `attendance:approve`                                                                                                 | Approve corrections and late submissions in scope                                   |
| `marks:enter`, `marks:moderate`                                                                                      | Enter/submit internal marks for courses taught; HOD approves or returns (Phase 4)   |
| `exam:manage`, `exam:condone`                                                                                        | Exam cell: timetable, SEE marks, publishing, revaluation; condonation decisions     |
| `condonation:request`, `revaluation:request`                                                                         | Class incharge/HOD request condonation; students request their own revaluation      |
| `leave:request`, `leave:approve`                                                                                     | Apply for / decide students' OD and medical leave in scope                          |
| `user:manage`                                                                                                        | Invite, suspend, revoke sessions                                                    |
| `role_assignment:manage`                                                                                             | Grant and revoke assignments                                                        |
| `audit:view`                                                                                                         | Read the audit trail (institution-wide scope required)                              |
| `academics:view`                                                                                                     | Read programmes, regulations, catalogue, terms, offerings (held anywhere)           |
| `academics:manage`                                                                                                   | Courses, regulations, offerings in scope; terms at institution level                |
| `teaching:allocate`                                                                                                  | Allocate faculty in scope — ceiling: must hold the faculty role's permissions there |
| `faculty:view`                                                                                                       | Faculty profiles and load, by home department                                       |
| `student:manage`                                                                                                     | Edit student records; move students within their batch (both sections in scope)     |
| `tenant:configure`                                                                                                   | Platform duties — Super Admin only                                                  |

Role → permission defaults live in `ROLE_DEFINITIONS`. Unit tests enforce catalogue invariants (the principal can
delegate every role but Super Admin; academic reads always include course-level attendance).

## Evaluation rules

1. No context → deny (`unauthenticated`). Resource in another tenant → deny (`cross-tenant access`). Org tree from
   another tenant → deny.
2. A permission applies only through an assignment whose scope **covers the resource**. Holding `student.finance:read`
   on one campus never reveals fees on another.
3. Field access for a student is the **union over covering assignments** that grant `student:view`. A class incharge
   of 3-CSE-A who also teaches CS302 in 3-CSE-B sees full class data on 3-A and only CS302 attendance on 3-B.
4. Filters, sorts and aggregates honour per-row field access: filtering by a hidden field matches nothing, sorting by a
   hidden field falls back to ID order, dashboard metrics count only readable rows.
5. Unknown and out-of-scope ids are indistinguishable to the caller (404 / "unavailable"); out-of-scope attempts on real
   records are audited as `denied`.

## Delegation (privilege escalation)

`src/domains/admin/guards.ts`:

1. Nobody changes their own access.
2. Act only inside your `role_assignment:manage` / `user:manage` scope.
3. **Ceiling** — grant or revoke only roles whose permissions you yourself hold over that unit. A principal cannot mint
   or remove a Super Admin; an HOD (no manage permission) cannot grant anything.
4. Suspend / sign out a user only if you cover all of their assignments and hold at least their authority.
5. Linked roles (student, parent) are granted at institution level with a student number.

The admin UI computes what to offer with the same guards, so it never offers an action the server will refuse.

## Effective access (verified by unit, integration and E2E tests)

| User                                                | Sees                                       | Cannot see                                              |
| --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Principal / Director / Super Admin                  | All 488 students, institution analytics    | Another tenant's anything                               |
| HOD CSE                                             | 168 CSE students, academics, risk, contact | ECE etc.; fees; audit log; access admin                 |
| Programme Coordinator B.Tech CSE                    | CSE students, academics, risk              | Contact, guardian, fees                                 |
| Class Incharge 3-CSE-A (+ faculty CS302 in 3-CSE-B) | 3-A in full; 3-B CS302 attendance only     | 3-CSE-C; fees                                           |
| Faculty DBMS                                        | 3-CSE-A/B, CS301 attendance only           | CGPA, risk, contact, fees, 3-CSE-C                      |
| Finance Officer                                     | All students' fees + contact               | Academics, risk                                         |
| Student                                             | Own record including fees                  | Classmates                                              |
| Parent                                              | Linked child's academics, fees, notices    | Child's risk flags and personal contact; other students |
| Northfield principal                                | Northfield only (0 students)               | All Demo University data                                |

## Academic structure (Phase 2)

`src/domains/academics/guards.ts`, pure and shared by pages and services:

- Structure describes the institution, not people, so `academics:view` held anywhere reads all of it.
- Changes need `academics:manage` covering the owning unit: the programme's department for regulations, the owner for
  courses, the section for offerings, the institution for terms. HODs and programme coordinators manage their own
  department; only the principal (and Super Admin) set the current term.
- Allocation needs `teaching:allocate` on the section, the ceiling (it grants faculty access), and never self.
- Faculty profiles: `faculty:view` covering the member's home department.

| Role                                                   | Academics            | Allocate     | Faculty view | Student records |
| ------------------------------------------------------ | -------------------- | ------------ | ------------ | --------------- |
| Principal                                              | View, manage (all)   | All sections | All          | Edit, move      |
| Director, Dean                                         | View                 | —            | All / scope  | —               |
| HOD                                                    | View, manage (dept.) | Dept.        | Dept.        | —               |
| Programme Coordinator                                  | View, manage (dept.) | —            | Dept.        | —               |
| Class incharge, coordinators, exam, placement, faculty | View                 | —            | —            | —               |

## Attendance (Phase 3)

`src/domains/attendance/guards.ts`, pure and shared by pages and services:

- **Mark** a course in a section: `attendance:edit` covering the section and, on a course-limited assignment (teaching
  allocation), the course itself. A class incharge or HOD may mark any course in scope (substitute classes).
- **Same-day window**: marking and edits are allowed on the class's own day from its start time (institution time,
  ADR-020). Afterwards every change is an `attendance_request` (correction, or late submission when never marked).
- **Approve** requests: `attendance:approve` over the section — HOD and principal. **Decide leave**: `leave:approve` —
  class incharge, HOD, principal. Nobody decides their own request: the service refuses it (audited as denied) and a
  check constraint rejects it in the database.
- **Apply for leave**: `leave:request` on the student — students and guardians through their link, staff in scope.
- **Analytics** for a section need `student.academic:read` there; the threshold and holidays need `academics:manage`
  at the institution (programme thresholds: over the programme's department).

| Role             | Mark                   | Approve attendance | Decide leave | Analytics  |
| ---------------- | ---------------------- | ------------------ | ------------ | ---------- |
| Principal        | Any (rarely used)      | All                | All          | All        |
| HOD              | Department             | Department         | Department   | Department |
| Class incharge   | Own class, any course  | —                  | Own class    | Own class  |
| Faculty          | Allocated courses only | —                  | —            | —          |
| Student / parent | —                      | —                  | Apply (own)  | Own record |

## Assessment and examinations (Phase 4)

`src/domains/exams/guards.ts`:

- **Enter marks**: `marks:enter` covering the section and, on a teaching assignment, the course — teachers for their
  courses, the class incharge for any course of the class.
- **Moderate**: `marks:moderate` over the section (HOD, principal), never one's own submission.
- **Exam cell**: `exam:manage` and `exam:condone` at the institution (Controller of Examinations, principal).
- **Requests**: `condonation:request` on the student (class incharge, HOD); `revaluation:request` (the student, via
  their link — guardians cannot).

## Defense in depth — Row-Level Security

Enabled on every tenant-owned business table (ADR-016). Business queries run through `withTenant()` as
`campusos_app` with `app.tenant_id` set for the transaction, so a query that forgets its tenant filter returns
nothing rather than another institution's rows. Integration tests cover: other tenant → 0 rows, no tenant → 0 rows,
writing a row for another tenant fails, the app role cannot update audit or read credentials. Identity and access
tables stay outside RLS (ADR-011): the auth library reads them, and loaders filter `tenant_id` explicitly.
