import { studentFieldAccess } from "@/lib/authz/engine";
import { roleDefinition } from "@/lib/authz/catalogue";
import { buildOrgTree } from "@/lib/authz/org-tree";
import { deriveTeachingAssignments } from "@/lib/authz/teaching";
import type { Assignment, AuthContext, OrgTree, StudentRef } from "@/lib/authz/types";
import { currentTermOfferings, FACULTY } from "@/lib/demo/academics";
import { STUDENTS } from "@/lib/demo/fixtures";
import { demoOrgSpecs, materialize, otherTenantOrgSpecs } from "@/lib/demo/org";
import { SEED_USERS } from "@/lib/demo/personas";
import type { Visible } from "@/domains/students/query";
import type { Student } from "@/domains/students/types";

/*
 * In-memory mirror of what the seed writes to Postgres: same org specs, same role catalogue, same users, same
 * teaching allocations. Org unit ids are their codes so assertions stay readable.
 */

export const DEMO_TENANT_ID = "tenant-demo";
export const OTHER_TENANT_ID = "tenant-other";

export const demoTree: OrgTree = buildOrgTree(
  DEMO_TENANT_ID,
  materialize(demoOrgSpecs(), (c) => c),
);
export const otherTree: OrgTree = buildOrgTree(
  OTHER_TENANT_ID,
  materialize(otherTenantOrgSpecs(), (c) => `nf-${c}`),
);

export function ctxFor(key: string, overrides: Partial<AuthContext> = {}): AuthContext {
  const u = SEED_USERS.find((x) => x.key === key);
  if (!u) throw new Error(`No seed user ${key}`);
  const other = u.tenantSlug !== "demo-university";
  const assignments: Assignment[] = u.assignments.map((a, i) => {
    const def = roleDefinition(a.role)!;
    return {
      id: `${key}-${i}`,
      roleKey: a.role,
      roleName: def.name,
      rank: def.rank,
      permissions: new Set(def.permissions),
      orgUnitId: other ? `nf-${a.orgUnitCode}` : a.orgUnitCode,
      scopeMode: a.scopeMode,
      courseCodes: a.courseCodes ?? null,
    };
  });
  const faculty = FACULTY.find((f) => f.email === u.email.toLowerCase());
  if (faculty && !other) {
    const facultyDef = roleDefinition("faculty")!;
    const refs = currentTermOfferings()
      .filter((o) => o.facultyName === faculty.name)
      .map((o) => ({ sectionId: o.sectionCode, sectionCode: o.sectionCode, courseCode: o.courseCode }));
    assignments.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
    assignments.push(
      ...deriveTeachingAssignments(refs, { ...facultyDef, permissions: new Set(facultyDef.permissions) }),
    );
    // Mirrors loadAuthContext: stable sort keeps teaching assignments in section-code order.
    assignments.sort((a, b) => a.rank - b.rank);
  }
  return {
    userId: `user-${key}`,
    email: u.email,
    name: u.name,
    image: null,
    tenantId: other ? OTHER_TENANT_ID : DEMO_TENANT_ID,
    tenantSlug: u.tenantSlug,
    tenantName: u.tenantSlug,
    assignments,
    links: u.links ?? [],
    active: assignments[0] ?? null,
    ...overrides,
  };
}

export const ref = (s: Student, tenantId = DEMO_TENANT_ID): StudentRef => ({
  tenantId,
  studentNumber: s.studentNumber,
  sectionCode: s.sectionId,
});

export function visibleFor(ctx: AuthContext, tree: OrgTree = demoTree): Visible[] {
  return STUDENTS.map((student) => ({ student, access: studentFieldAccess(ctx, tree, ref(student)) })).filter(
    (v) => v.access.view,
  );
}

export const studentIn = (sectionCode: string, index = 0) =>
  STUDENTS.filter((s) => s.sectionId === sectionCode)[index]!;
