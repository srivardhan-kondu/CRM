# Deployment

## Local setup

```bash
npm install
cp .env.example .env.local      # fill DATABASE_URL(_UNPOOLED), BETTER_AUTH_SECRET, Google credentials
npm run db:setup                # migrate + seed (idempotent)
npm run dev                     # http://localhost:3000
```

Node ≥ 20.9 (CI uses Node 22). Without Google credentials, the Google button explains it isn't configured, and demo
personas still work when `CAMPUSOS_DEMO_MODE=true`.

### Google OAuth client

1. Google Cloud Console → APIs & Services → OAuth consent screen: create (Internal for a Workspace domain, or
   External + add test users).
2. Credentials → Create credentials → OAuth client ID → **Web application**.
3. Authorised JavaScript origin: `http://localhost:3000` (plus your production origin).
4. Authorised redirect URI: `http://localhost:3000/api/auth/callback/google` (plus production).
5. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart.

Only provisioned emails can sign in: `CAMPUSOS_BOOTSTRAP_ADMIN_EMAIL` (seeded Super Admin), or anyone invited from
Administration → Users & access.

## Database scripts

| Script                     | Does                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run db:generate`      | Generate a migration from schema changes (`drizzle-kit generate`)                           |
| `npm run db:migrate`       | Apply migrations to `DATABASE_URL_UNPOOLED` (`--test` targets the test DB)                  |
| `npm run db:seed`          | Idempotent synthetic seed                                                                   |
| `npm run db:setup`         | migrate + seed                                                                              |
| `npm run test:integration` | **Drops and recreates** `TEST_DATABASE_URL`, migrates from empty, seeds, runs DB tests      |
| `npm run test:e2e`         | Same reset with demo personas, builds, serves on :3100 against the test DB, runs Playwright |

### Phase 2 upgrade (migrations 0002–0003)

Migrate **before** deploying Phase 2 code: the app runs every business query as the `campusos_app` role, which
migration 0003 creates. That migration:

- creates the NOLOGIN role `campusos_app` if it doesn't exist (roles are cluster-wide, so the app and test databases
  on one Neon endpoint share it);
- grants it to the migrating (connection) role so the app can switch into it per transaction;
- grants it narrow table privileges and enables RLS on the business tables.

The connection role needs `CREATEROLE`, which Neon's owner role has. Then `npm run db:seed` loads the Phase 2 synthetic
data and revokes the Phase 1 persona faculty grants that allocations now replace.

## CI — `.github/workflows/ci.yml`

- `verify`: typecheck, lint, format check, unit tests, production build — no secrets needed.
- `database`: integration + E2E, enabled when repository secrets `DATABASE_URL`, `TEST_DATABASE_URL`,
  `TEST_DATABASE_URL_UNPOOLED` and `BETTER_AUTH_SECRET` are set (skips with a notice otherwise).

## Environments and Neon branches

| Environment      | Neon branch      | Notes                                                               |
| ---------------- | ---------------- | ------------------------------------------------------------------- |
| Production       | `main`           | `CAMPUSOS_ENV=production`, demo mode off, no developer write access |
| Staging          | `staging`        | Synthetic seed only                                                 |
| Preview (per PR) | `preview/pr-<n>` | Created from `staging` in CI, deleted on close                      |
| Developer        | `dev/<name>`     | Personal branch                                                     |
| CI               | `ci`             | Holds the `campusos_test` database the suites rebuild               |

The current project has a single branch; creating these needs the Neon console or an API key (not configured here).

## Demo deployment (Vercel)

The demo runs on synthetic data with one-click personas and no email provider (email is recorded in the Delivery log,
never sent). `vercel.json` pins functions to `sin1`, next to the Neon database (ap-southeast-1); pages make many
sequential queries, so a distant region is slow.

| Variable                       | Value                                                             |
| ------------------------------ | ----------------------------------------------------------------- |
| `DATABASE_URL`                 | Neon pooled URL                                                   |
| `BETTER_AUTH_SECRET`           | A new 32+ character secret (`openssl rand -base64 32`)            |
| `BETTER_AUTH_URL`              | The public origin, e.g. `https://campusos-demo.vercel.app`        |
| `NEXT_PUBLIC_APP_URL`          | Same origin                                                       |
| `CAMPUSOS_DEMO_MODE`           | `true`                                                            |
| `CAMPUSOS_ENV`                 | `staging` (`production` refuses demo mode by design)              |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Optional; without them the Google button explains it isn't set up |

Migrate and seed from a machine with `.env.local` (`npm run db:setup`) before the first deploy. Anyone with the URL can
sign in as any persona and change the demo data; the data is synthetic and changes persist until the database is
reset. The demo personas' passwords derive from `BETTER_AUTH_SECRET`, so the deployed secret must be the one the
database was seeded with (`npm run db:seed` with the same secret).

## Production checklist

`CAMPUSOS_ENV=production` · `CAMPUSOS_DEMO_MODE=false` · `CRON_SECRET` set and a cron calling
`/api/cron/notifications` every few minutes · an email transport in place of the log transport · strong `BETTER_AUTH_SECRET` · `BETTER_AUTH_URL` = public
origin · Google redirect URI registered · non-owner DB role for the app · backups + restore drill · monitoring ·
rate limits · CSP.
