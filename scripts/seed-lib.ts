import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "../src/db/schema";
import { demoPasswordFor } from "../src/lib/auth/demo-password";
import { PERMISSIONS, ROLE_DEFINITIONS } from "../src/lib/authz/catalogue";
import {
  DEMO_TENANT,
  demoOrgSpecs,
  OTHER_TENANT,
  otherTenantOrgSpecs,
  type OrgSpec,
} from "../src/lib/demo/org";
import { SEED_USERS, SUPERSEDED_FACULTY_GRANTS, type SeedUser } from "../src/lib/demo/personas";
import { TERMS } from "../src/lib/demo/academics";
import { revokeSupersededFacultyGrants, seedAcademics, seedCalendar } from "./seed-academics";
import { seedAttendance } from "./seed-attendance";
import { seedCommunication } from "./seed-communication";
import { seedExams } from "./seed-exams";

type Db = NeonHttpDatabase<typeof s>;

export interface SeedOptions {
  /** Create password credentials for demo personas (CAMPUSOS_DEMO_MODE). */
  demoPasswords: boolean;
  secret: string;
  /** Real Google account granted Super Admin of the demo tenant. */
  bootstrapAdminEmail?: string;
  log?: (msg: string) => void;
}

/** Idempotent: re-running updates names/permissions and adds missing rows without duplicating or revoking anything. */
export async function seed(db: Db, opts: SeedOptions) {
  const log = opts.log ?? (() => {});

  // Permission catalogue
  await db
    .insert(s.permission)
    .values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })))
    .onConflictDoUpdate({ target: s.permission.key, set: { description: sql`excluded.description` } });

  const tenants = new Map<string, string>();
  for (const [t, specs] of [
    [DEMO_TENANT, demoOrgSpecs()],
    [OTHER_TENANT, otherTenantOrgSpecs()],
  ] as const) {
    const [row] = await db
      .insert(s.tenant)
      .values({ slug: t.slug, name: t.name })
      .onConflictDoUpdate({ target: s.tenant.slug, set: { name: t.name } })
      .returning({ id: s.tenant.id });
    tenants.set(t.slug, row!.id);
    await seedOrg(db, row!.id, specs);
    await seedRoles(db, row!.id);
    log(`tenant ${t.slug}: org units, roles`);
  }

  const demoTenantId = tenants.get(DEMO_TENANT.slug)!;
  await seedCalendar(db, demoTenantId);
  await seedCalendar(
    db,
    tenants.get(OTHER_TENANT.slug)!,
    TERMS.filter((t) => t.isCurrent),
  );
  // Students must exist before persona links reference them.
  await seedAcademics(db, demoTenantId, log);

  const userIds = new Map<string, string>();
  for (const u of SEED_USERS) {
    userIds.set(u.key, await seedUser(db, tenants.get(u.tenantSlug)!, u, opts));
  }
  await revokeSupersededFacultyGrants(
    db,
    demoTenantId,
    SUPERSEDED_FACULTY_GRANTS.personaKeys.map((k) => userIds.get(k)!),
    SUPERSEDED_FACULTY_GRANTS.reason,
  );
  log(`${SEED_USERS.length} synthetic users`);
  // Leave and requests reference persona accounts, so attendance follows the users.
  await seedAttendance(db, demoTenantId, userIds, log);
  // Eligibility and condonation depend on recorded attendance, so examinations follow it.
  await seedExams(db, demoTenantId, userIds, log);
  // Notices reach students and guardians, and messages follow attendance, so communication comes last.
  await seedCommunication(db, demoTenantId, userIds, log);

  if (opts.bootstrapAdminEmail) {
    await seedUser(
      db,
      demoTenantId,
      {
        key: "bootstrap_admin",
        name: opts.bootstrapAdminEmail.split("@")[0]!,
        email: opts.bootstrapAdminEmail.toLowerCase(),
        title: "Super Admin",
        tenantSlug: DEMO_TENANT.slug,
        assignments: [{ role: "super_admin", orgUnitCode: "DUG", scopeMode: "subtree" }],
        persona: false,
      },
      { ...opts, demoPasswords: false },
    );
    log(`bootstrap super admin: ${opts.bootstrapAdminEmail}`);
  }

  return { tenants };
}

async function seedOrg(db: Db, tenantId: string, specs: OrgSpec[]) {
  const placed = new Map<string, { id: string; path: string; depth: number }>();
  for (const spec of specs) {
    const parent = spec.parentCode ? placed.get(spec.parentCode) : undefined;
    const id = randomUUID();
    const [row] = await db
      .insert(s.orgUnit)
      .values({
        id,
        tenantId,
        parentId: parent?.id ?? null,
        type: spec.type,
        code: spec.code,
        name: spec.name,
        path: `${parent?.path ?? "/"}${id}/`,
        depth: parent ? parent.depth + 1 : 0,
      })
      // Existing units keep their id and path; only the display name is refreshed.
      .onConflictDoUpdate({ target: [s.orgUnit.tenantId, s.orgUnit.code], set: { name: spec.name } })
      .returning({ id: s.orgUnit.id, path: s.orgUnit.path, depth: s.orgUnit.depth });
    placed.set(spec.code, row!);
  }
}

async function seedRoles(db: Db, tenantId: string) {
  for (const def of ROLE_DEFINITIONS) {
    const [row] = await db
      .insert(s.role)
      .values({ tenantId, key: def.key, name: def.name, rank: def.rank, isSystem: true })
      .onConflictDoUpdate({ target: [s.role.tenantId, s.role.key], set: { name: def.name, rank: def.rank } })
      .returning({ id: s.role.id });
    const roleId = row!.id;
    // System role permissions are owned by the catalogue: add missing, remove ones no longer listed.
    await db
      .delete(s.rolePermission)
      .where(
        and(eq(s.rolePermission.roleId, roleId), notInArray(s.rolePermission.permissionKey, def.permissions)),
      );
    await db
      .insert(s.rolePermission)
      .values(def.permissions.map((permissionKey) => ({ roleId, permissionKey })))
      .onConflictDoNothing();
  }
}

async function seedUser(db: Db, tenantId: string, u: SeedUser, opts: SeedOptions): Promise<string> {
  const [user] = await db
    .insert(s.appUser)
    // Provisioned by an administrator, so the address is treated as verified: Google sign-in links to it.
    .values({ name: u.name, email: u.email.toLowerCase(), emailVerified: true })
    .onConflictDoUpdate({ target: s.appUser.email, set: { name: u.name, emailVerified: true } })
    .returning({ id: s.appUser.id });
  const userId = user!.id;

  await db.insert(s.tenantMembership).values({ tenantId, userId }).onConflictDoNothing();

  const units = await db
    .select({ id: s.orgUnit.id, code: s.orgUnit.code })
    .from(s.orgUnit)
    .where(
      and(
        eq(s.orgUnit.tenantId, tenantId),
        inArray(
          s.orgUnit.code,
          u.assignments.map((a) => a.orgUnitCode),
        ),
      ),
    );
  const roles = await db
    .select({ id: s.role.id, key: s.role.key })
    .from(s.role)
    .where(
      and(
        eq(s.role.tenantId, tenantId),
        inArray(
          s.role.key,
          u.assignments.map((a) => a.role),
        ),
      ),
    );

  for (const a of u.assignments) {
    const orgUnitId = units.find((x) => x.code === a.orgUnitCode)?.id;
    const roleId = roles.find((x) => x.key === a.role)?.id;
    if (!orgUnitId || !roleId) throw new Error(`Seed: unknown unit/role ${a.orgUnitCode}/${a.role}`);
    const existing = await db
      .select({ id: s.roleAssignment.id })
      .from(s.roleAssignment)
      .where(
        and(
          eq(s.roleAssignment.userId, userId),
          eq(s.roleAssignment.roleId, roleId),
          eq(s.roleAssignment.orgUnitId, orgUnitId),
          isNull(s.roleAssignment.revokedAt),
        ),
      );
    if (existing.length === 0) {
      await db.insert(s.roleAssignment).values({
        tenantId,
        userId,
        roleId,
        orgUnitId,
        scopeMode: a.scopeMode,
        courseCodes: a.courseCodes ?? null,
        validFrom: "2026-06-15",
      });
    }
  }

  for (const link of u.links ?? []) {
    await db
      .insert(s.studentLink)
      .values({ tenantId, userId, ...link })
      .onConflictDoNothing();
  }

  if (opts.demoPasswords && u.persona) {
    const password = await hashPassword(demoPasswordFor(u.email, opts.secret));
    const current = await db
      .select({ id: s.authAccount.id })
      .from(s.authAccount)
      .where(and(eq(s.authAccount.userId, userId), eq(s.authAccount.providerId, "credential")));
    if (current.length === 0) {
      await db
        .insert(s.authAccount)
        .values({ userId, accountId: userId, providerId: "credential", password });
    } else {
      await db
        .update(s.authAccount)
        .set({ password, updatedAt: new Date() })
        .where(eq(s.authAccount.id, current[0]!.id));
    }
  }
  return userId;
}
