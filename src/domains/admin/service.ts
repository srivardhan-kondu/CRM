import "server-only";

import { and, eq, gt, isNull, lte, or, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { auditValues } from "@/lib/audit/record";
import { denied as deniedAs, fail, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { studentNumberExists } from "@/domains/students/load";
import { canGrant, canInviteUsers, canManageUser, canRevoke } from "./guards";

export type { ActionResult };

const denied = (authed: Authed, action: string, reason: string, resourceId?: string) =>
  deniedAs(authed, action, "user", reason, resourceId);

/* ---------- Invite ---------- */

export const inviteSchema = z.object({
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  name: z.string().trim().min(2, "Enter the person's name.").max(120),
});

/**
 * Provision a user into this institution. The address is marked verified because an administrator vouches for
 * it; that is what allows their Google sign-in to link to this account (sign-up itself stays disabled).
 */
export async function inviteUser(authed: Authed, input: unknown): Promise<ActionResult> {
  const { ctx } = authed;
  const guard = canInviteUsers(ctx);
  if (!guard.ok) return denied(authed, "user.invite", guard.reason);
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { email, name } = parsed.data;
  const db = getDb();

  const [existing] = await db.select({ id: s.appUser.id }).from(s.appUser).where(eq(s.appUser.email, email));
  if (existing) {
    const [member] = await db
      .select({ status: s.tenantMembership.status })
      .from(s.tenantMembership)
      .where(and(eq(s.tenantMembership.tenantId, ctx.tenantId), eq(s.tenantMembership.userId, existing.id)));
    if (member) return fail(`${email} is already a member of ${ctx.tenantName}.`);
  }

  const userId = existing?.id ?? crypto.randomUUID();
  const audit = await auditValues({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: "user.invite",
    resourceType: "user",
    resourceId: userId,
    outcome: "success",
    metadata: { email, existingIdentity: !!existing },
  });
  // Audit first only because a batch tuple needs a fixed head; the batch is one transaction either way.
  await db.batch([
    db.insert(s.auditEvent).values(audit),
    ...(existing ? [] : [db.insert(s.appUser).values({ id: userId, name, email, emailVerified: true })]),
    db.insert(s.tenantMembership).values({ tenantId: ctx.tenantId, userId, createdBy: ctx.userId }),
  ] as const);
  return {
    ok: true,
    message: `${email} can now sign in with Google. Grant them a role to give them access.`,
    auditId: audit.id,
  };
}

/* ---------- Grant ---------- */

export const grantSchema = z
  .object({
    userId: z.uuid(),
    roleId: z.uuid(),
    orgUnitId: z.uuid(),
    scopeMode: z.enum(["subtree", "unit", "linked"]),
    courseCodes: z
      .string()
      .trim()
      .transform((v) => (v ? v.split(/[\s,]+/).map((c) => c.toUpperCase()) : []))
      .pipe(z.array(z.string().regex(/^[A-Z]{2,4}\d{3}[A-Z]?$/, "Course codes look like CS301."))),
    studentNumber: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .optional(),
    validFrom: z.iso.date().optional(),
    validTo: z
      .union([z.iso.date(), z.literal("")])
      .transform((v) => v || null)
      .optional(),
  })
  .refine((v) => !v.validTo || !v.validFrom || v.validTo >= v.validFrom, {
    message: "The end date must be on or after the start date.",
  })
  .refine((v) => v.scopeMode !== "linked" || !!v.studentNumber, {
    message: "Student and parent roles need the student number they're linked to.",
  });

export async function grantAssignment(authed: Authed, input: unknown): Promise<ActionResult> {
  const { ctx, tree } = authed;
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const req = parsed.data;
  const db = getDb();

  const [target] = await db
    .select({ userId: s.tenantMembership.userId, status: s.tenantMembership.status, email: s.appUser.email })
    .from(s.tenantMembership)
    .innerJoin(s.appUser, eq(s.appUser.id, s.tenantMembership.userId))
    .where(and(eq(s.tenantMembership.tenantId, ctx.tenantId), eq(s.tenantMembership.userId, req.userId)));
  if (!target)
    return denied(
      authed,
      "role_assignment.grant",
      "That user isn't a member of this institution.",
      req.userId,
    );

  const roleRows = await db
    .select({ key: s.role.key, name: s.role.name, permission: s.rolePermission.permissionKey })
    .from(s.role)
    .leftJoin(s.rolePermission, eq(s.rolePermission.roleId, s.role.id))
    .where(and(eq(s.role.id, req.roleId), eq(s.role.tenantId, ctx.tenantId)));
  if (roleRows.length === 0) return fail("Unknown role.");
  const role = roleRows[0]!;
  const rolePermissions = new Set(roleRows.map((r) => r.permission).filter((p): p is string => !!p));

  const isLinkedRole = role.key === "student" || role.key === "parent";
  if (isLinkedRole !== (req.scopeMode === "linked")) {
    return fail(
      isLinkedRole
        ? "Student and parent roles use a linked scope."
        : "Only student and parent roles use a linked scope.",
    );
  }

  const guard = canGrant(ctx, tree, {
    targetUserId: req.userId,
    orgUnitId: req.orgUnitId,
    scopeMode: req.scopeMode,
    rolePermissions,
  });
  if (!guard.ok) return denied(authed, "role_assignment.grant", guard.reason, req.userId);

  if (isLinkedRole && !(await studentNumberExists(db, ctx.tenantId, req.studentNumber!))) {
    return fail(`No student ${req.studentNumber} exists in ${ctx.tenantName}.`);
  }

  const [duplicate] = await db
    .select({ id: s.roleAssignment.id })
    .from(s.roleAssignment)
    .where(
      and(
        eq(s.roleAssignment.userId, req.userId),
        eq(s.roleAssignment.roleId, req.roleId),
        eq(s.roleAssignment.orgUnitId, req.orgUnitId),
        isNull(s.roleAssignment.revokedAt),
      ),
    );
  if (duplicate) return fail(`${target.email} already holds ${role.name} there.`);

  const unit = tree.byId.get(req.orgUnitId)!;
  const assignmentId = crypto.randomUUID();
  const audit = await auditValues({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: "role_assignment.grant",
    resourceType: "user",
    resourceId: req.userId,
    outcome: "success",
    metadata: {
      assignmentId,
      role: role.key,
      orgUnit: unit.code,
      scopeMode: req.scopeMode,
      courseCodes: req.courseCodes,
      studentNumber: req.studentNumber ?? null,
      validFrom: req.validFrom ?? null,
      validTo: req.validTo ?? null,
      target: target.email,
    },
  });

  await db.batch([
    db.insert(s.roleAssignment).values({
      id: assignmentId,
      tenantId: ctx.tenantId,
      userId: req.userId,
      roleId: req.roleId,
      orgUnitId: req.orgUnitId,
      scopeMode: req.scopeMode,
      courseCodes: req.courseCodes.length ? req.courseCodes : null,
      validFrom: req.validFrom ?? sql`current_date`,
      validTo: req.validTo ?? null,
      grantedBy: ctx.userId,
    }),
    ...(isLinkedRole
      ? [
          db
            .insert(s.studentLink)
            .values({
              tenantId: ctx.tenantId,
              userId: req.userId,
              studentNumber: req.studentNumber!,
              relation: role.key === "parent" ? ("guardian" as const) : ("self" as const),
            })
            .onConflictDoNothing(),
        ]
      : []),
    db.insert(s.auditEvent).values(audit),
  ] as const);

  return { ok: true, message: `Granted ${role.name} on ${unit.name} to ${target.email}.`, auditId: audit.id };
}

/* ---------- Revoke ---------- */

export const revokeSchema = z.object({
  assignmentId: z.uuid(),
  reason: z.string().trim().min(3, "Give a short reason — it's kept in the audit trail.").max(300),
});

export async function revokeAssignment(authed: Authed, input: unknown): Promise<ActionResult> {
  const { ctx, tree } = authed;
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const db = getDb();

  const rows = await db
    .select({
      userId: s.roleAssignment.userId,
      orgUnitId: s.roleAssignment.orgUnitId,
      revokedAt: s.roleAssignment.revokedAt,
      roleKey: s.role.key,
      roleName: s.role.name,
      permission: s.rolePermission.permissionKey,
    })
    .from(s.roleAssignment)
    .innerJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
    .leftJoin(s.rolePermission, eq(s.rolePermission.roleId, s.role.id))
    .where(
      and(eq(s.roleAssignment.id, parsed.data.assignmentId), eq(s.roleAssignment.tenantId, ctx.tenantId)),
    );
  const a = rows[0];
  if (!a)
    return denied(
      authed,
      "role_assignment.revoke",
      "Assignment not found in this institution.",
      parsed.data.assignmentId,
    );
  if (a.revokedAt) return fail("That assignment is already revoked.");

  const guard = canRevoke(ctx, tree, {
    targetUserId: a.userId,
    orgUnitId: a.orgUnitId,
    rolePermissions: new Set(rows.map((r) => r.permission).filter((p): p is string => !!p)),
  });
  if (!guard.ok) return denied(authed, "role_assignment.revoke", guard.reason, a.userId);

  const audit = await auditValues({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: "role_assignment.revoke",
    resourceType: "user",
    resourceId: a.userId,
    outcome: "success",
    reason: parsed.data.reason,
    metadata: {
      assignmentId: parsed.data.assignmentId,
      role: a.roleKey,
      orgUnit: tree.byId.get(a.orgUnitId)?.code,
    },
  });
  await db.batch([
    db
      .update(s.roleAssignment)
      .set({ revokedAt: new Date(), revokedBy: ctx.userId, revokeReason: parsed.data.reason })
      // Guard against a concurrent revoke: only an unrevoked row changes.
      .where(and(eq(s.roleAssignment.id, parsed.data.assignmentId), isNull(s.roleAssignment.revokedAt))),
    db.insert(s.auditEvent).values(audit),
  ] as const);
  return {
    ok: true,
    message: `Revoked ${a.roleName}. It stops applying on the user's next request.`,
    auditId: audit.id,
  };
}

/* ---------- Membership & sessions ---------- */

async function loadTarget(authed: Authed, userId: string) {
  const db = getDb();
  const [member] = await db
    .select({ status: s.tenantMembership.status, email: s.appUser.email })
    .from(s.tenantMembership)
    .innerJoin(s.appUser, eq(s.appUser.id, s.tenantMembership.userId))
    .where(and(eq(s.tenantMembership.tenantId, authed.ctx.tenantId), eq(s.tenantMembership.userId, userId)));
  if (!member) return null;
  const rows = await db
    .select({
      id: s.roleAssignment.id,
      orgUnitId: s.roleAssignment.orgUnitId,
      permission: s.rolePermission.permissionKey,
    })
    .from(s.roleAssignment)
    .innerJoin(s.role, eq(s.role.id, s.roleAssignment.roleId))
    .leftJoin(s.rolePermission, eq(s.rolePermission.roleId, s.role.id))
    .where(
      and(
        eq(s.roleAssignment.tenantId, authed.ctx.tenantId),
        eq(s.roleAssignment.userId, userId),
        isNull(s.roleAssignment.revokedAt),
        lte(s.roleAssignment.validFrom, sql`current_date`),
        or(isNull(s.roleAssignment.validTo), gte(s.roleAssignment.validTo, sql`current_date`)),
      ),
    );
  const byId = new Map<string, { orgUnitId: string; permissions: Set<string> }>();
  for (const r of rows) {
    const cur = byId.get(r.id) ?? { orgUnitId: r.orgUnitId, permissions: new Set<string>() };
    if (r.permission) cur.permissions.add(r.permission);
    byId.set(r.id, cur);
  }
  return { ...member, userId, assignments: [...byId.values()] };
}

export const membershipSchema = z.object({ userId: z.uuid(), status: z.enum(["active", "suspended"]) });

/** Suspension blocks all access to this institution immediately and ends the user's sessions. */
export async function setMembershipStatus(authed: Authed, input: unknown): Promise<ActionResult> {
  const { ctx, tree } = authed;
  const parsed = membershipSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const target = await loadTarget(authed, parsed.data.userId);
  if (!target)
    return denied(authed, "user.membership", "User not found in this institution.", parsed.data.userId);
  const guard = canManageUser(ctx, tree, target);
  if (!guard.ok) return denied(authed, "user.membership", guard.reason, target.userId);
  if (target.status === parsed.data.status) return fail(`Already ${parsed.data.status}.`);

  const db = getDb();
  const suspending = parsed.data.status === "suspended";
  const audit = await auditValues({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: suspending ? "user.suspend" : "user.reactivate",
    resourceType: "user",
    resourceId: target.userId,
    outcome: "success",
    metadata: { email: target.email },
  });
  await db.batch([
    db
      .update(s.tenantMembership)
      .set({ status: parsed.data.status })
      .where(
        and(eq(s.tenantMembership.tenantId, ctx.tenantId), eq(s.tenantMembership.userId, target.userId)),
      ),
    ...(suspending ? [db.delete(s.authSession).where(eq(s.authSession.userId, target.userId))] : []),
    db.insert(s.auditEvent).values(audit),
  ] as const);
  return {
    ok: true,
    message: suspending
      ? `${target.email} is suspended and signed out everywhere.`
      : `${target.email} is active again.`,
    auditId: audit.id,
  };
}

export const revokeSessionsSchema = z.object({ userId: z.uuid() });

export async function revokeSessions(authed: Authed, input: unknown): Promise<ActionResult> {
  const { ctx, tree } = authed;
  const parsed = revokeSessionsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const target = await loadTarget(authed, parsed.data.userId);
  if (!target)
    return denied(authed, "session.revoke", "User not found in this institution.", parsed.data.userId);
  const guard = canManageUser(ctx, tree, target);
  if (!guard.ok) return denied(authed, "session.revoke", guard.reason, target.userId);

  const db = getDb();
  const live = await db
    .select({ id: s.authSession.id })
    .from(s.authSession)
    .where(and(eq(s.authSession.userId, target.userId), gt(s.authSession.expiresAt, sql`now()`)));
  const audit = await auditValues({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: "session.revoke",
    resourceType: "user",
    resourceId: target.userId,
    outcome: "success",
    metadata: { email: target.email, sessions: live.length },
  });
  await db.batch([
    db.delete(s.authSession).where(eq(s.authSession.userId, target.userId)),
    db.insert(s.auditEvent).values(audit),
  ] as const);
  return {
    ok: true,
    message: `Signed ${target.email} out of ${live.length} session${live.length === 1 ? "" : "s"}.`,
    auditId: audit.id,
  };
}
