import { authorize, coversUnit } from "@/lib/authz/engine";
import type { AuthContext, OrgTree, StudentRef } from "@/lib/authz/types";

/*
 * Who may do what with attendance. Pure policy over the auth context; services call these before every change,
 * and pages use them to decide which controls to render. Separation of duties (nobody approves their own request)
 * is checked in the services and again by the database.
 */

/**
 * Record attendance for a course in a section: `attendance:edit` over the section, and — on an assignment limited
 * to courses (teaching allocations) — the course among them. A class incharge or HOD can mark any course in their
 * scope, e.g. for a substitute class.
 */
export function canMarkCourse(
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
      a.permissions.has("attendance:edit") &&
      coversUnit(a, unit, tree) &&
      (a.courseCodes === null || a.courseCodes.includes(courseCode)),
  );
}

const atUnit = (ctx: AuthContext, tree: OrgTree, permission: string, orgUnitId: string) =>
  authorize(ctx, tree, permission, { kind: "org_unit", tenantId: ctx.tenantId, orgUnitId }).allowed;

/** Approve corrections and late submissions for a section's sessions. */
export const canApproveAttendanceIn = (ctx: AuthContext, tree: OrgTree, sectionId: string) =>
  atUnit(ctx, tree, "attendance:approve", sectionId);

/** Approve or reject a student's OD / medical leave (decided at the student's section). */
export const canDecideLeaveIn = (ctx: AuthContext, tree: OrgTree, sectionId: string) =>
  atUnit(ctx, tree, "leave:approve", sectionId);

/** Apply for leave for a student: staff over the student's section, students and guardians for their own record. */
export const canRequestLeaveFor = (ctx: AuthContext, tree: OrgTree, student: StudentRef) =>
  authorize(ctx, tree, "leave:request", { kind: "student", student }).allowed;

/** Section-level attendance analytics show every student's figures, so they need cohort academics there. */
export const canViewSectionAttendance = (ctx: AuthContext, tree: OrgTree, sectionId: string) =>
  atUnit(ctx, tree, "student.academic:read", sectionId);

/** Change the institution's default threshold (institution-wide academics management). */
export const canSetInstitutionPolicy = (ctx: AuthContext, tree: OrgTree) =>
  atUnit(ctx, tree, "academics:manage", tree.root.id);

/** Override a programme's threshold: academics management over the programme's department. */
export const canSetProgrammeThreshold = (ctx: AuthContext, tree: OrgTree, departmentId: string) =>
  atUnit(ctx, tree, "academics:manage", departmentId);

/** Declare a holiday: institution-wide academics management (a holiday applies to every section). */
export const canDeclareHoliday = canSetInstitutionPolicy;
