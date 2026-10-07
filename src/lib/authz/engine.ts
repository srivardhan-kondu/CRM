import { isWithin } from "./org-tree";
import type { Assignment, AuthContext, Decision, OrgNode, OrgTree, Resource, StudentRef } from "./types";

/*
 * The CampusOS policy engine (PRD §4): subject → role → action → resource → org scope → field sensitivity → context.
 * Pure and synchronous: callers load the AuthContext and OrgTree; this module decides. Deny by default —
 * every path that is not an explicit grant returns allowed: false with a reason.
 */

const deny = (reason: string): Decision => ({ allowed: false, reason, via: [] });

/** Does the assignment's scope contain this org unit? (`linked` assignments never cover org units.) */
export function coversUnit(a: Assignment, unit: OrgNode, tree: OrgTree): boolean {
  const scopeUnit = tree.byId.get(a.orgUnitId);
  if (!scopeUnit) return false;
  if (a.scopeMode === "subtree") return isWithin(unit, scopeUnit);
  if (a.scopeMode === "unit") return unit.id === scopeUnit.id;
  return false;
}

export function coversStudent(ctx: AuthContext, a: Assignment, s: StudentRef, tree: OrgTree): boolean {
  if (s.tenantId !== ctx.tenantId) return false;
  if (a.scopeMode === "linked") {
    const wanted = a.roleKey === "parent" ? "guardian" : "self";
    return ctx.links.some((l) => l.studentNumber === s.studentNumber && l.relation === wanted);
  }
  const section = tree.byCode.get(s.sectionCode);
  return section ? coversUnit(a, section, tree) : false;
}

function covers(ctx: AuthContext, a: Assignment, resource: Resource, tree: OrgTree): boolean {
  switch (resource.kind) {
    case "student":
      return coversStudent(ctx, a, resource.student, tree);
    case "org_unit": {
      const unit = tree.byId.get(resource.orgUnitId);
      return !!unit && coversUnit(a, unit, tree);
    }
    case "tenant":
      // Tenant-wide permissions (e.g. reading the audit trail) need an assignment over the whole institution.
      return a.scopeMode === "subtree" && a.orgUnitId === tree.root.id;
  }
}

function resourceTenant(resource: Resource): string {
  return resource.kind === "student" ? resource.student.tenantId : resource.tenantId;
}

export function authorize(
  ctx: AuthContext | null,
  tree: OrgTree | null,
  permission: string,
  resource: Resource,
): Decision {
  if (!ctx) return deny("unauthenticated");
  if (!tree || tree.tenantId !== ctx.tenantId) return deny("org tree unavailable for tenant");
  if (resourceTenant(resource) !== ctx.tenantId) return deny("cross-tenant access");

  const via = ctx.assignments
    .filter((a) => a.permissions.has(permission) && covers(ctx, a, resource, tree))
    .map((a) => a.id);
  if (via.length === 0) {
    const hasPermissionSomewhere = ctx.assignments.some((a) => a.permissions.has(permission));
    return deny(hasPermissionSomewhere ? "outside assigned scope" : `missing permission ${permission}`);
  }
  return { allowed: true, reason: "granted", via };
}

export type FieldClass = "contact" | "guardian" | "academic" | "risk" | "finance";

export interface StudentFieldAccess {
  view: boolean;
  contact: boolean;
  guardian: boolean;
  academic: boolean;
  risk: boolean;
  finance: boolean;
  /** "all" when academic is readable; otherwise course codes from teaching assignments that cover the student. */
  courseAttendance: "all" | readonly string[];
}

const NO_ACCESS: StudentFieldAccess = {
  view: false,
  contact: false,
  guardian: false,
  academic: false,
  risk: false,
  finance: false,
  courseAttendance: [],
};

/**
 * Field-level access for one student: the union over assignments that both cover the student and grant
 * `student:view`. A field permission held only on a *different* scope never applies here.
 */
export function studentFieldAccess(
  ctx: AuthContext | null,
  tree: OrgTree | null,
  s: StudentRef,
): StudentFieldAccess {
  if (!ctx || !tree || tree.tenantId !== ctx.tenantId || s.tenantId !== ctx.tenantId) return NO_ACCESS;
  const covering = ctx.assignments.filter(
    (a) => a.permissions.has("student:view") && coversStudent(ctx, a, s, tree),
  );
  if (covering.length === 0) return NO_ACCESS;
  const has = (p: string) => covering.some((a) => a.permissions.has(p));
  const academic = has("student.academic:read");
  const courses = new Set<string>();
  for (const a of covering) {
    if (a.permissions.has("student.course_attendance:read"))
      for (const c of a.courseCodes ?? []) courses.add(c);
  }
  return {
    view: true,
    contact: has("student.contact:read"),
    guardian: has("student.guardian:read"),
    academic,
    risk: has("student.risk:read"),
    finance: has("student.finance:read"),
    courseAttendance: academic ? "all" : [...courses].sort(),
  };
}

/* ---- Named helpers (PRD §30.1). Thin wrappers so call sites read as intent. ---- */

export const canViewStudent = (ctx: AuthContext | null, tree: OrgTree | null, s: StudentRef) =>
  authorize(ctx, tree, "student:view", { kind: "student", student: s }).allowed;

export function canEditAttendance(
  ctx: AuthContext | null,
  tree: OrgTree | null,
  sectionCode: string,
): boolean {
  const unit = tree?.byCode.get(sectionCode);
  if (!ctx || !tree || !unit) return false;
  return authorize(ctx, tree, "attendance:edit", {
    kind: "org_unit",
    tenantId: ctx.tenantId,
    orgUnitId: unit.id,
  }).allowed;
}

export function canPublishAnnouncement(
  ctx: AuthContext | null,
  tree: OrgTree | null,
  orgUnitId: string,
): boolean {
  if (!ctx) return false;
  return authorize(ctx, tree, "announcement:publish", { kind: "org_unit", tenantId: ctx.tenantId, orgUnitId })
    .allowed;
}

/** Export needs its own permission over every unit in the requested scope — view access alone is never enough. */
export function canExportStudents(
  ctx: AuthContext | null,
  tree: OrgTree | null,
  orgUnitIds: readonly string[],
): boolean {
  if (!ctx || orgUnitIds.length === 0) return false;
  return orgUnitIds.every(
    (id) =>
      authorize(ctx, tree, "student:export", { kind: "org_unit", tenantId: ctx.tenantId, orgUnitId: id })
        .allowed,
  );
}

export function canManageAssignmentsAt(
  ctx: AuthContext | null,
  tree: OrgTree | null,
  orgUnitId: string,
): boolean {
  if (!ctx) return false;
  return authorize(ctx, tree, "role_assignment:manage", {
    kind: "org_unit",
    tenantId: ctx.tenantId,
    orgUnitId,
  }).allowed;
}

/** Union of permissions the user holds over a unit — the ceiling for what they may delegate there. */
export function permissionsAt(ctx: AuthContext, tree: OrgTree, orgUnitId: string): Set<string> {
  const unit = tree.byId.get(orgUnitId);
  const out = new Set<string>();
  if (!unit) return out;
  for (const a of ctx.assignments) if (coversUnit(a, unit, tree)) for (const p of a.permissions) out.add(p);
  return out;
}

/** True if the user holds the permission on any scope — for showing entry points, never for granting access. */
export function holdsAnywhere(ctx: AuthContext | null, permission: string): boolean {
  return !!ctx?.assignments.some((a) => a.permissions.has(permission));
}
