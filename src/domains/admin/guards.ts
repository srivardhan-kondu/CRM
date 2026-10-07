import { authorize, coversUnit, permissionsAt } from "@/lib/authz/engine";
import type { AuthContext, OrgTree, ScopeMode } from "@/lib/authz/types";

/*
 * Delegation rules for administration (PRD §30.6 "privilege escalation"). Pure functions so they are unit-tested
 * independently of the database. Every rule denies by default.
 *
 *  1. Nobody changes their own access.
 *  2. You act only inside your `role_assignment:manage` / `user:manage` scope.
 *  3. Ceiling: you can grant — or revoke — only roles whose permissions you yourself hold over that unit.
 *     So a Principal cannot mint a Super Admin, and cannot disable one either.
 *  4. Linked roles (student / parent) are anchored at the institution and need institution-wide authority.
 */

export type GuardResult = { ok: true } | { ok: false; reason: string };

const deny = (reason: string): GuardResult => ({ ok: false, reason });

export interface GrantRequest {
  targetUserId: string;
  orgUnitId: string;
  scopeMode: ScopeMode;
  rolePermissions: ReadonlySet<string>;
}

export function canGrant(ctx: AuthContext, tree: OrgTree, req: GrantRequest): GuardResult {
  if (req.targetUserId === ctx.userId)
    return deny("You can't change your own access. Ask another administrator.");
  const unit = tree.byId.get(req.orgUnitId);
  if (!unit) return deny("That organisational unit doesn't exist in this institution.");
  if (req.scopeMode === "linked" && unit.id !== tree.root.id)
    return deny("Student and parent roles are granted at institution level.");
  const decision = authorize(ctx, tree, "role_assignment:manage", {
    kind: "org_unit",
    tenantId: ctx.tenantId,
    orgUnitId: unit.id,
  });
  if (!decision.allowed) return deny("You can't manage role assignments for that part of the institution.");
  const ceiling = permissionsAt(ctx, tree, unit.id);
  const exceeding = [...req.rolePermissions].filter((p) => !ceiling.has(p));
  if (exceeding.length)
    return deny(`That role includes permissions you don't hold there: ${exceeding.sort().join(", ")}.`);
  return { ok: true };
}

export interface RevokeRequest {
  targetUserId: string;
  orgUnitId: string;
  rolePermissions: ReadonlySet<string>;
}

export function canRevoke(ctx: AuthContext, tree: OrgTree, req: RevokeRequest): GuardResult {
  if (req.targetUserId === ctx.userId)
    return deny("You can't revoke your own access. Ask another administrator.");
  const unit = tree.byId.get(req.orgUnitId);
  if (!unit) return deny("Assignment scope not found.");
  const manages = ctx.assignments.some(
    (a) => a.permissions.has("role_assignment:manage") && coversUnit(a, unit, tree),
  );
  if (!manages) return deny("You can't manage role assignments for that part of the institution.");
  const ceiling = permissionsAt(ctx, tree, unit.id);
  if ([...req.rolePermissions].some((p) => !ceiling.has(p))) {
    return deny(
      "That assignment carries authority you don't hold, so only a more senior administrator can revoke it.",
    );
  }
  return { ok: true };
}

export interface UserTarget {
  userId: string;
  /** The target's active assignments: where they sit and what they can do. */
  assignments: { orgUnitId: string; permissions: ReadonlySet<string> }[];
}

/** Suspending a membership or revoking sessions: need user:manage over everything the target holds, and seniority. */
export function canManageUser(ctx: AuthContext, tree: OrgTree, target: UserTarget): GuardResult {
  if (target.userId === ctx.userId)
    return deny("You can't suspend yourself or revoke your own sessions here.");
  const managers = ctx.assignments.filter((a) => a.permissions.has("user:manage"));
  if (managers.length === 0) return deny("You don't have permission to manage users.");
  const tenantWide = managers.some((a) => a.scopeMode === "subtree" && a.orgUnitId === tree.root.id);
  for (const a of target.assignments) {
    const unit = tree.byId.get(a.orgUnitId);
    if (!unit) continue;
    if (!tenantWide && !managers.some((m) => coversUnit(m, unit, tree))) {
      return deny("This user holds roles outside your scope.");
    }
    const ceiling = permissionsAt(ctx, tree, unit.id);
    if ([...a.permissions].some((p) => !ceiling.has(p))) {
      return deny(
        "This user holds authority you don't, so only a more senior administrator can manage them.",
      );
    }
  }
  if (target.assignments.length === 0 && !tenantWide)
    return deny("Only institution-wide administrators manage users without roles.");
  return { ok: true };
}

export function canInviteUsers(ctx: AuthContext): GuardResult {
  return ctx.assignments.some((a) => a.permissions.has("user:manage"))
    ? { ok: true }
    : deny("You don't have permission to invite users.");
}
