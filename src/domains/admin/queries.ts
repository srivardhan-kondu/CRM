import "server-only";

import { and, count, desc, eq, gt, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { Authed } from "@/lib/authz/context";
import { canManageUser, canRevoke } from "@/domains/admin/guards";
import { authorize, coversUnit } from "@/lib/authz/engine";

export interface UserAssignmentRow {
  id: string;
  roleKey: string;
  roleName: string;
  orgUnitId: string;
  orgUnitName: string;
  orgUnitCode: string;
  scopeMode: "subtree" | "unit" | "linked";
  courseCodes: string[] | null;
  validFrom: string;
  validTo: string | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  /** Whether the viewer may revoke this assignment (scope covers it and it is not their own). */
  manageable: boolean;
}

export interface TenantUserRow {
  userId: string;
  name: string;
  email: string;
  status: "active" | "suspended";
  signIn: "google" | "password" | "none";
  activeSessions: number;
  /** Whether the viewer may suspend this user or end their sessions (same guard as the actions). */
  manageable: boolean;
  assignments: UserAssignmentRow[];
  /** Sections taught this term: access that derives from allocation rather than a grant (ADR-017). */
  teaching: string[];
}

/**
 * Users of the current tenant that the viewer may administer: those holding at least one assignment inside
 * the viewer's `user:manage` / `role_assignment:manage` scope, plus users with no assignments yet (just
 * provisioned) for tenant-wide administrators. Returns null if the viewer has no admin permission at all.
 */
export async function listTenantUsers({ ctx, tree }: Authed, q?: string): Promise<TenantUserRow[] | null> {
  const manageScopes = ctx.assignments.filter(
    (a) => a.permissions.has("role_assignment:manage") || a.permissions.has("user:manage"),
  );
  if (manageScopes.length === 0) return null;
  const tenantWide = manageScopes.some((a) => a.scopeMode === "subtree" && a.orgUnitId === tree.root.id);

  const db = getDb();
  const filters: SQL[] = [eq(s.tenantMembership.tenantId, ctx.tenantId)];
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    filters.push(or(ilike(s.appUser.name, like), ilike(s.appUser.email, like))!);
  }
  const users = await db
    .select({
      userId: s.appUser.id,
      name: s.appUser.name,
      email: s.appUser.email,
      status: s.tenantMembership.status,
    })
    .from(s.tenantMembership)
    .innerJoin(s.appUser, eq(s.appUser.id, s.tenantMembership.userId))
    .where(and(...filters))
    .orderBy(s.appUser.name)
    .limit(500);
  if (users.length === 0) return [];
  const ids = users.map((u) => u.userId);

  const [assignments, accounts, sessions, rolePerms, [teaching]] = await Promise.all([
    db
      .select({
        id: s.roleAssignment.id,
        userId: s.roleAssignment.userId,
        roleKey: s.role.key,
        roleName: s.role.name,
        orgUnitId: s.orgUnit.id,
        orgUnitName: s.orgUnit.name,
        orgUnitCode: s.orgUnit.code,
        scopeMode: s.roleAssignment.scopeMode,
        courseCodes: s.roleAssignment.courseCodes,
        validFrom: s.roleAssignment.validFrom,
        validTo: s.roleAssignment.validTo,
        revokedAt: s.roleAssignment.revokedAt,
        revokeReason: s.roleAssignment.revokeReason,
      })
      .from(s.roleAssignment)
      .innerJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
      .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.roleAssignment.orgUnitId))
      .where(and(eq(s.roleAssignment.tenantId, ctx.tenantId), inArray(s.roleAssignment.userId, ids)))
      .orderBy(desc(s.roleAssignment.grantedAt)),
    db
      .select({ userId: s.authAccount.userId, providerId: s.authAccount.providerId })
      .from(s.authAccount)
      .where(inArray(s.authAccount.userId, ids)),
    db
      .select({ userId: s.authSession.userId, n: count() })
      .from(s.authSession)
      .where(and(inArray(s.authSession.userId, ids), gt(s.authSession.expiresAt, sql`now()`)))
      .groupBy(s.authSession.userId),
    db
      .select({ roleKey: s.role.key, permission: s.rolePermission.permissionKey })
      .from(s.rolePermission)
      .innerJoin(s.role, eq(s.role.id, s.rolePermission.roleId))
      .where(eq(s.role.tenantId, ctx.tenantId)),
    withTenant(db, ctx.tenantId, (t) => [
      t
        .selectDistinct({ userId: s.teachingAllocation.userId, section: s.section.label })
        .from(s.teachingAllocation)
        .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.teachingAllocation.offeringId))
        .innerJoin(s.section, eq(s.section.orgUnitId, s.courseOffering.sectionId))
        .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseOffering.termId))
        .where(
          and(
            inArray(s.teachingAllocation.userId, ids),
            isNull(s.teachingAllocation.removedAt),
            eq(s.academicTerm.isCurrent, true),
          ),
        )
        .orderBy(s.section.label),
    ]),
  ]);
  const permsOf = (roleKey: string) =>
    new Set(rolePerms.filter((r) => r.roleKey === roleKey).map((r) => r.permission));

  const rows: TenantUserRow[] = users.map((u) => {
    const mine = assignments
      .filter((a) => a.userId === u.userId)
      .map((row) => {
        const { userId: _owner, ...a } = row;
        void _owner;
        // Same guard the revoke action applies, so the UI never offers an action the server will refuse.
        const manageable =
          !a.revokedAt &&
          canRevoke(ctx, tree, {
            targetUserId: u.userId,
            orgUnitId: a.orgUnitId,
            rolePermissions: permsOf(a.roleKey),
          }).ok;
        return { ...a, manageable };
      });
    return {
      ...u,
      signIn: accounts.some((x) => x.userId === u.userId && x.providerId === "google")
        ? "google"
        : accounts.some((x) => x.userId === u.userId && x.providerId === "credential")
          ? "password"
          : "none",
      teaching: teaching.filter((t) => t.userId === u.userId).map((t) => t.section),
      activeSessions: sessions.find((x) => x.userId === u.userId)?.n ?? 0,
      manageable: canManageUser(ctx, tree, {
        userId: u.userId,
        assignments: mine
          .filter((a) => !a.revokedAt)
          .map((a) => ({ orgUnitId: a.orgUnitId, permissions: permsOf(a.roleKey) })),
      }).ok,
      assignments: mine,
    };
  });

  return rows.filter((r) => {
    if (tenantWide) return true;
    // Scoped administrators only see users who hold something inside their scope.
    return r.assignments.some((a) => {
      const unit = tree.byId.get(a.orgUnitId);
      return !!unit && manageScopes.some((m) => coversUnit(m, unit, tree));
    });
  });
}

/** Tenant roles with their permissions as stored — the same source the grant action checks against. */
export async function listGrantableRoles({ ctx }: Authed) {
  const rows = await getDb()
    .select({
      id: s.role.id,
      key: s.role.key,
      name: s.role.name,
      rank: s.role.rank,
      permission: s.rolePermission.permissionKey,
    })
    .from(s.role)
    .leftJoin(s.rolePermission, eq(s.rolePermission.roleId, s.role.id))
    .where(eq(s.role.tenantId, ctx.tenantId))
    .orderBy(s.role.rank);
  const byId = new Map<
    string,
    { id: string; key: string; name: string; rank: number; permissions: Set<string> }
  >();
  for (const r of rows) {
    const role = byId.get(r.id) ?? {
      id: r.id,
      key: r.key,
      name: r.name,
      rank: r.rank,
      permissions: new Set<string>(),
    };
    if (r.permission) role.permissions.add(r.permission);
    byId.set(r.id, role);
  }
  return [...byId.values()];
}

export interface AuditRow {
  id: string;
  occurredAt: Date;
  actorEmail: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: "success" | "denied" | "failure";
  reason: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditQuery {
  action?: string;
  outcome?: "success" | "denied" | "failure";
  actor?: string;
  before?: string;
}

/**
 * Audit trail for the tenant (plus tenant-less auth events by this tenant's members). Requires `audit:view`
 * over the whole institution. Keyset-paginated by time.
 */
export async function listAuditEvents(
  authed: Authed,
  query: AuditQuery,
  limit = 50,
): Promise<AuditRow[] | null> {
  const { ctx } = authed;
  if (!authorize(ctx, authed.tree, "audit:view", { kind: "tenant", tenantId: ctx.tenantId }).allowed)
    return null;
  const db = getDb();
  const members = db
    .select({ id: s.tenantMembership.userId })
    .from(s.tenantMembership)
    .where(eq(s.tenantMembership.tenantId, ctx.tenantId));

  const filters: SQL[] = [
    or(
      eq(s.auditEvent.tenantId, ctx.tenantId),
      and(isNull(s.auditEvent.tenantId), inArray(s.auditEvent.actorUserId, members)),
    )!,
  ];
  if (query.action) filters.push(ilike(s.auditEvent.action, `${query.action}%`));
  if (query.outcome) filters.push(eq(s.auditEvent.outcome, query.outcome));
  if (query.actor) filters.push(ilike(s.auditEvent.actorEmail, `%${query.actor}%`));
  if (query.before) filters.push(lt(s.auditEvent.occurredAt, new Date(query.before)));

  return db
    .select({
      id: s.auditEvent.id,
      occurredAt: s.auditEvent.occurredAt,
      actorEmail: s.auditEvent.actorEmail,
      actorUserId: s.auditEvent.actorUserId,
      action: s.auditEvent.action,
      resourceType: s.auditEvent.resourceType,
      resourceId: s.auditEvent.resourceId,
      outcome: s.auditEvent.outcome,
      reason: s.auditEvent.reason,
      ipAddress: s.auditEvent.ipAddress,
      metadata: s.auditEvent.metadata,
    })
    .from(s.auditEvent)
    .where(and(...filters))
    .orderBy(desc(s.auditEvent.occurredAt))
    .limit(limit);
}

export async function adminOverview({ ctx }: Authed) {
  const db = getDb();
  const [[users], [assignments], [sessions], [denials]] = await Promise.all([
    db.select({ n: count() }).from(s.tenantMembership).where(eq(s.tenantMembership.tenantId, ctx.tenantId)),
    db
      .select({ n: count() })
      .from(s.roleAssignment)
      .where(and(eq(s.roleAssignment.tenantId, ctx.tenantId), isNull(s.roleAssignment.revokedAt))),
    db
      .select({ n: count() })
      .from(s.authSession)
      .innerJoin(s.tenantMembership, eq(s.tenantMembership.userId, s.authSession.userId))
      .where(and(eq(s.tenantMembership.tenantId, ctx.tenantId), gt(s.authSession.expiresAt, sql`now()`))),
    db
      .select({ n: count() })
      .from(s.auditEvent)
      .where(
        and(
          eq(s.auditEvent.tenantId, ctx.tenantId),
          eq(s.auditEvent.outcome, "denied"),
          gt(s.auditEvent.occurredAt, sql`now() - interval '7 days'`),
        ),
      ),
  ]);
  return {
    users: users?.n ?? 0,
    assignments: assignments?.n ?? 0,
    sessions: sessions?.n ?? 0,
    denials: denials?.n ?? 0,
  };
}
