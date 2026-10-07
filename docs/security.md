# Security

## Authentication

- **Better Auth** with database sessions (12 h expiry, 1 h refresh, no cookie cache), so revocation and suspension
  apply on the very next request. Cookies are prefixed `campusos`, httpOnly, `secure` in production.
- **Google sign-in, provision-only.** `disableSignUp` on the provider plus a `user.create.before` hook that always
  refuses: identities are created only by administrators (`user.invite`). An unknown Google account gets
  `?error=signup_disabled` and a clear message.
- **Account linking** is restricted to the trusted Google provider and requires the provisioned user row to be
  `emailVerified` (Better Auth's takeover guard). Admin-provisioned users are marked verified, since the
  administrator vouches for the address and Google proves ownership via `email_verified`.
- **Session creation is gated** on an active tenant membership (`session.create.before`).
- **Demo personas** use password sign-in with passwords derived by HMAC from `BETTER_AUTH_SECRET`, so no credential
  sits in the repository. Password sign-in exists only when `CAMPUSOS_DEMO_MODE=true`, and env validation refuses it
  when `CAMPUSOS_ENV=production`.

## Authorization

See [authorization.md](authorization.md). Deny by default, tenant check first, scope-covered permissions, per-record
field projection before serialization, delegation ceiling for administration.

## Audit

`audit_event` is append-only: a trigger rejects UPDATE, DELETE and TRUNCATE for every role (verified by integration
tests). Recorded today:

| Event                                                               | When                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `auth.sign_in` success / denied                                     | Every session created; refused for users with no active membership |
| `auth.sign_up` denied                                               | Any attempt to create an identity through the auth flow            |
| `auth.sign_out`                                                     | Explicit sign-out                                                  |
| `auth.error`                                                        | Auth API errors (e.g. unknown Google account)                      |
| `student.view` success / denied                                     | Every Student 360 open; out-of-scope attempts on real records      |
| `user.invite`, `user.suspend`, `user.reactivate`, `session.revoke`  | Admin actions (with target)                                        |
| `role_assignment.grant` / `.revoke`                                 | With role, unit, scope, validity, reason                           |
| `course.create`                                                     | New catalogue course with owner, credits and hours                 |
| `regulation.create` / `.course_add` / `.course_remove`              | Draft regulation edits                                             |
| `regulation.publish` / `.retire`                                    | Status changes                                                     |
| `term.set_current`                                                  | With the previous current term                                     |
| `offering.generate`                                                 | Count of offerings and sections created                            |
| `teaching.allocate` / `.remove`                                     | Term, section, course, faculty, role or reason                     |
| `student.update`                                                    | Changed fields with before and after values                        |
| `student.transfer`                                                  | From and to section, reason                                        |
| `attendance.mark`                                                   | Session saved or recorded as not held; counts and previous state   |
| `attendance.request` / `.request.approve` / `.reject` / `.withdraw` | Correction or late submission, with reason and decision note       |
| `leave.request` / `.approve` / `.reject` / `.withdraw`              | Student OD / medical leave, dates and note                         |
| `attendance.policy.update`, `attendance.programme_threshold.update` | Thresholds                                                         |
| `marks.save` / `.submit` / `.approve` / `.return`                   | Component, course, section, entries or note                        |
| `exam.marks.save`, `exam.publish`                                   | Paper and entries; results published and passed                    |
| `condonation.request` / `.approve` / `.reject`                      | Student, attendance, note                                          |
| `revaluation.request` / `.complete`                                 | Original, revalued and awarded marks                               |
| `holiday.declare`                                                   | Date and occasion                                                  |
| `announcement.save_draft` / `.submit` / `.publish`                  | Title, audience, severity, attachment count                        |
| `announcement.approve` / `.reject` / `.recall` / `.withdraw`        | With note or reason                                                |
| `announcement.delete`, `.acknowledge`, `.remind`                    | Draft removed; who acknowledged as which recipient; reminder count |
| `announcement.attachment_download` success / denied                 | Every download attempt (background)                                |
| `guardian_message.send` / `.acknowledge`                            | Template, students, addresses missing; whether a reply was sent    |
| `notification.dispatch`                                             | Sent, failed, more waiting                                         |
| `*` denied                                                          | Any refused admin action, with the reason shown to the user        |

Mutations write the change and its audit row in one Neon transaction (`db.batch`) and return the audit id.
Sensitive reads are audited in the background via `after()`.

Business-table transactions run as `campusos_app`, which may only INSERT into `audit_event`. **Production hardening
still to do:** identity/access queries and auth still use the owner connection (which could drop triggers). Move them
to a non-owner login role, and ship audit to an external sink.

## Transport and headers

TLS via Neon (`sslmode=require`, `channel_binding=require`); `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options: DENY`, `Permissions-Policy`; `X-Powered-By` off. Server actions are POST-only with Next's origin
check.

## PRD §30.6 acceptance status

| Test                             | Status                                                                                | Where                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Cross-tenant access              | ✅                                                                                    | unit, integration, E2E                                                    |
| Cross-department / cross-section | ✅                                                                                    | unit, E2E                                                                 |
| Privilege escalation             | ✅                                                                                    | guard unit tests, catalogue invariants, E2E (UI never offers Super Admin) |
| Export bypass                    | ✅ engine level (`canExportStudents` separate permission); export UI ships in Phase 9 |
| Direct URL / API access          | ✅                                                                                    | E2E (401 / redirect / 404)                                                |
| API mutation bypass              | ✅                                                                                    | Server actions re-authenticate and use the same guards; denials audited   |
| Hidden-field leakage             | ✅                                                                                    | projection + filter/sort tests; HTML payload checks                       |
| Attachment URL leakage           | ✅                                                                                    | No public URL: every download re-checks visibility; 404 otherwise; E2E    |
| Audit log tampering              | ✅                                                                                    | DB trigger, integration test                                              |
| Session revocation               | ✅                                                                                    | E2E "sign out everywhere"                                                 |
| Role removal                     | ✅                                                                                    | integration + E2E (next request loses access)                             |

## Known gaps

| Gap                                                                      | Plan                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| No MFA for privileged roles                                              | Phase 11 (Better Auth two-factor plugin; step-up for admin actions)         |
| No rate limiting on sign-in / search beyond Better Auth defaults         | Phase 11                                                                    |
| Identity/access tables outside RLS; owner connection for auth            | Non-owner login role for the whole app (Phase 11)                           |
| No CSP                                                                   | Nonce-based CSP in Phase 11                                                 |
| Sign out everywhere ends sessions across all tenants the user belongs to | Acceptable for now; per-tenant sessions if multi-tenant users become common |
