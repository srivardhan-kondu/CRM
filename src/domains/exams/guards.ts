import { authorize, coversUnit } from "@/lib/authz/engine";
import type { AuthContext, OrgTree, StudentRef } from "@/lib/authz/types";

/*
 * Who may do what with assessment and examinations. Pure policy; services check before every change and pages use
 * the same functions to decide what to offer. Nobody moderates their own marks or decides their own request — the
 * services refuse it and the database functions reject it.
 */

/** Enter internal marks for a course in a section: `marks:enter` there, and on a course-limited assignment the course. */
export function canEnterMarks(
  ctx: AuthContext,
  tree: OrgTree,
  sectionId: string,
  courseCode: string,
): boolean {
  const unit = tree.byId.get(sectionId);
  if (!unit || tree.tenantId !== ctx.tenantId) return false;
  return ctx.assignments.some(
    (a) =>
      a.scopeMode !== "linked" &&
      a.permissions.has("marks:enter") &&
      coversUnit(a, unit, tree) &&
      (a.courseCodes === null || a.courseCodes.includes(courseCode)),
  );
}

const atUnit = (ctx: AuthContext, tree: OrgTree, permission: string, orgUnitId: string) =>
  authorize(ctx, tree, permission, { kind: "org_unit", tenantId: ctx.tenantId, orgUnitId }).allowed;

/** Approve or return a section's submitted internal marks. */
export const canModerateIn = (ctx: AuthContext, tree: OrgTree, sectionId: string) =>
  atUnit(ctx, tree, "marks:moderate", sectionId);

/** Examinations are run institution-wide by the exam cell. */
export const canManageExams = (ctx: AuthContext, tree: OrgTree) =>
  atUnit(ctx, tree, "exam:manage", tree.root.id);

export const canDecideCondonation = (ctx: AuthContext, tree: OrgTree) =>
  atUnit(ctx, tree, "exam:condone", tree.root.id);

export const canRequestCondonationFor = (ctx: AuthContext, tree: OrgTree, student: StudentRef) =>
  authorize(ctx, tree, "condonation:request", { kind: "student", student }).allowed;

export const canRequestRevaluationFor = (ctx: AuthContext, tree: OrgTree, student: StudentRef) =>
  authorize(ctx, tree, "revaluation:request", { kind: "student", student }).allowed;
