import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { buildOrgTree } from "./org-tree";
import { deriveTeachingAssignments, type TeachingRef } from "./teaching";
import type { Assignment, AuthContext, OrgTree } from "./types";

/*
 * Database loaders for the policy engine. Deliberately free of Next.js imports so integration tests can run
 * them against the test database. Request-scoped caching lives in context.ts.
 */

type Db = NeonHttpDatabase<typeof s>;

export async function loadOrgTree(db: Db, tenantId: string): Promise<OrgTree> {
  const rows = await db
    .select({
      id: s.orgUnit.id,
      parentId: s.orgUnit.parentId,
      type: s.orgUnit.type,
      code: s.orgUnit.code,
      name: s.orgUnit.name,
      path: s.orgUnit.path,
      depth: s.orgUnit.depth,
    })
    .from(s.orgUnit)
    .where(
      and(
        eq(s.orgUnit.tenantId, tenantId),
        lte(s.orgUnit.validFrom, sql`current_date`),
        or(isNull(s.orgUnit.validTo), gte(s.orgUnit.validTo, sql`current_date`)),
      ),
    )
    .orderBy(asc(s.orgUnit.depth), asc(s.orgUnit.code));
  return buildOrgTree(tenantId, rows);
}

export interface LoadOptions {
  /** Preferred tenant (e.g. from a tenant switcher cookie); falls back to the first active membership. */
  tenantId?: string | null;
  /** Preferred workspace assignment id; falls back to the most senior role. */
  activeAssignmentId?: string | null;
}

/** Tenants the user can enter: active membership in an active tenant. */
export async function loadMemberships(db: Db, userId: string) {
  return db
    .select({ tenantId: s.tenant.id, slug: s.tenant.slug, name: s.tenant.name })
    .from(s.tenantMembership)
    .innerJoin(s.tenant, eq(s.tenant.id, s.tenantMembership.tenantId))
    .where(
      and(
        eq(s.tenantMembership.userId, userId),
        eq(s.tenantMembership.status, "active"),
        eq(s.tenant.status, "active"),
      ),
    )
    .orderBy(asc(s.tenant.name));
}

/**
 * Builds the AuthContext for a user. Returns null when the user has no active membership — that user can
 * authenticate but can access nothing. Revoked, not-yet-valid and expired assignments are excluded here, so
 * role removal applies on the next request.
 */
export async function loadAuthContext(
  db: Db,
  userId: string,
  opts: LoadOptions = {},
): Promise<AuthContext | null> {
  const [user] = await db
    .select({ id: s.appUser.id, email: s.appUser.email, name: s.appUser.name, image: s.appUser.image })
    .from(s.appUser)
    .where(eq(s.appUser.id, userId));
  if (!user) return null;

  const memberships = await loadMemberships(db, userId);
  const tenant = memberships.find((m) => m.tenantId === opts.tenantId) ?? memberships[0];
  if (!tenant) return null;

  const rows = await db
    .select({
      id: s.roleAssignment.id,
      roleKey: s.role.key,
      roleName: s.role.name,
      rank: s.role.rank,
      orgUnitId: s.roleAssignment.orgUnitId,
      scopeMode: s.roleAssignment.scopeMode,
      courseCodes: s.roleAssignment.courseCodes,
      permission: s.rolePermission.permissionKey,
    })
    .from(s.roleAssignment)
    .innerJoin(
      s.role,
      and(eq(s.role.id, s.roleAssignment.roleId), eq(s.role.tenantId, s.roleAssignment.tenantId)),
    )
    .innerJoin(
      s.orgUnit,
      and(eq(s.orgUnit.id, s.roleAssignment.orgUnitId), eq(s.orgUnit.tenantId, s.roleAssignment.tenantId)),
    )
    .leftJoin(s.rolePermission, eq(s.rolePermission.roleId, s.role.id))
    .where(
      and(
        eq(s.roleAssignment.tenantId, tenant.tenantId),
        eq(s.roleAssignment.userId, userId),
        isNull(s.roleAssignment.revokedAt),
        lte(s.roleAssignment.validFrom, sql`current_date`),
        or(isNull(s.roleAssignment.validTo), gte(s.roleAssignment.validTo, sql`current_date`)),
      ),
    );

  const byId = new Map<string, Assignment & { permissions: Set<string> }>();
  for (const r of rows) {
    let a = byId.get(r.id);
    if (!a) {
      a = {
        id: r.id,
        roleKey: r.roleKey,
        roleName: r.roleName,
        rank: r.rank,
        orgUnitId: r.orgUnitId,
        scopeMode: r.scopeMode,
        courseCodes: r.courseCodes,
        permissions: new Set<string>(),
      };
      byId.set(r.id, a);
    }
    if (r.permission) a.permissions.add(r.permission);
  }
  const granted = [...byId.values()];
  const teaching = await loadTeachingAssignments(db, tenant.tenantId, userId);
  // Granted assignments order by rank then id; teaching ones keep their section-code order (the sort is stable),
  // so the default workspace does not depend on random section ids.
  granted.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const assignments = [...granted, ...teaching].sort((a, b) => a.rank - b.rank);

  const links = await db
    .select({ studentNumber: s.studentLink.studentNumber, relation: s.studentLink.relation })
    .from(s.studentLink)
    .where(and(eq(s.studentLink.tenantId, tenant.tenantId), eq(s.studentLink.userId, userId)));

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    assignments,
    links,
    active: assignments.find((a) => a.id === opts.activeAssignmentId) ?? assignments[0] ?? null,
  };
}

/** Current-term teaching allocations for a user (business tables: read under RLS). */
export async function loadTeachingRefs(db: Db, tenantId: string, userId: string): Promise<TeachingRef[]> {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        sectionId: s.courseOffering.sectionId,
        sectionCode: s.orgUnit.code,
        courseCode: s.course.code,
      })
      .from(s.teachingAllocation)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.teachingAllocation.offeringId))
      .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.courseOffering.sectionId))
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseOffering.termId))
      .where(
        and(
          eq(s.teachingAllocation.userId, userId),
          isNull(s.teachingAllocation.removedAt),
          eq(s.academicTerm.isCurrent, true),
        ),
      ),
  ]);
  return rows;
}

/** Teaching allocations as unit-scoped assignments carrying the tenant's faculty-role permissions. */
async function loadTeachingAssignments(db: Db, tenantId: string, userId: string): Promise<Assignment[]> {
  const refs = await loadTeachingRefs(db, tenantId, userId);
  if (refs.length === 0) return [];
  const roleRows = await db
    .select({ name: s.role.name, rank: s.role.rank, permission: s.rolePermission.permissionKey })
    .from(s.role)
    .leftJoin(s.rolePermission, eq(s.rolePermission.roleId, s.role.id))
    .where(and(eq(s.role.tenantId, tenantId), eq(s.role.key, "faculty")));
  const first = roleRows[0];
  if (!first) return [];
  return deriveTeachingAssignments(refs, {
    key: "faculty",
    name: first.name,
    rank: first.rank,
    permissions: new Set(roleRows.map((r) => r.permission).filter((p): p is string => !!p)),
  });
}
