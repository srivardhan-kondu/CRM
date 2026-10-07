import { neon } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { canViewStudent, studentFieldAccess } from "@/lib/authz/engine";
import { loadAuthContext, loadOrgTree } from "@/lib/authz/load";
import type { OrgTree, StudentRef } from "@/lib/authz/types";
import { STUDENTS } from "@/lib/demo/fixtures";
import { DEMO_TENANT, OTHER_TENANT } from "@/lib/demo/org";
import { SEED_USERS } from "@/lib/demo/personas";
import { seed } from "../../scripts/seed-lib";

const db = drizzle({ client: neon(process.env.TEST_DATABASE_URL!), schema: s, casing: "snake_case" });

let demoTenantId = "";
let otherTenantId = "";
let tree: OrgTree;

async function userId(key: string) {
  const email = SEED_USERS.find((u) => u.key === key)!.email.toLowerCase();
  const [row] = await db.select({ id: s.appUser.id }).from(s.appUser).where(eq(s.appUser.email, email));
  return row!.id;
}

const ref = (sectionCode: string, tenantId = demoTenantId): StudentRef => {
  const st = STUDENTS.find((x) => x.sectionId === sectionCode)!;
  return { tenantId, studentNumber: st.studentNumber, sectionCode };
};

/** A fresh user with one assignment, so mutation tests never disturb the seeded personas. */
async function makeUser(
  label: string,
  roleKey: string,
  unitCode: string,
  extra: Partial<typeof s.roleAssignment.$inferInsert> = {},
) {
  const [u] = await db
    .insert(s.appUser)
    .values({ name: label, email: `${label}-${crypto.randomUUID()}@test.campusos.dev`, emailVerified: true })
    .returning({ id: s.appUser.id });
  await db.insert(s.tenantMembership).values({ tenantId: demoTenantId, userId: u!.id });
  const [role] = await db
    .select({ id: s.role.id })
    .from(s.role)
    .where(and(eq(s.role.tenantId, demoTenantId), eq(s.role.key, roleKey)));
  const [assignment] = await db
    .insert(s.roleAssignment)
    .values({
      tenantId: demoTenantId,
      userId: u!.id,
      roleId: role!.id,
      orgUnitId: tree.byCode.get(unitCode)!.id,
      ...extra,
    })
    .returning({ id: s.roleAssignment.id });
  return { userId: u!.id, assignmentId: assignment!.id };
}

beforeAll(async () => {
  const tenants = await db.select({ id: s.tenant.id, slug: s.tenant.slug }).from(s.tenant);
  demoTenantId = tenants.find((t) => t.slug === DEMO_TENANT.slug)!.id;
  otherTenantId = tenants.find((t) => t.slug === OTHER_TENANT.slug)!.id;
  tree = await loadOrgTree(db, demoTenantId);
});

describe("schema & seed", () => {
  it("builds one rooted org tree per tenant with consistent materialised paths", async () => {
    expect(tree.root.code).toBe("DUG");
    for (const node of tree.byId.values()) {
      const parent = node.parentId ? tree.byId.get(node.parentId) : null;
      expect(node.path).toBe(`${parent?.path ?? "/"}${node.id}/`);
    }
    const other = await loadOrgTree(db, otherTenantId);
    expect(other.root.code).toBe("NFC");
    expect([...other.byId.values()].every((n) => !tree.byId.has(n.id))).toBe(true);
  });

  it("is idempotent — re-seeding adds no rows", async () => {
    const counts = async () =>
      Promise.all(
        [
          s.orgUnit,
          s.role,
          s.rolePermission,
          s.appUser,
          s.tenantMembership,
          s.roleAssignment,
          s.studentLink,
          s.programme,
          s.curriculum,
          s.curriculumCourse,
          s.course,
          s.batch,
          s.section,
          s.academicTerm,
          s.courseOffering,
          s.teachingAllocation,
          s.facultyProfile,
          s.student,
          s.guardian,
          s.studentSectionHistory,
        ].map(async (t) => {
          const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t);
          return r!.n;
        }),
      );
    const before = await counts();
    await seed(db, { secret: "integration-test-secret-integration-test", demoPasswords: false });
    expect(await counts()).toEqual(before);
  });
});

describe("AuthContext from the database", () => {
  it("loads granted roles plus teaching derived from allocations", async () => {
    const ctx = (await loadAuthContext(db, await userId("class_incharge")))!;
    expect(ctx.tenantSlug).toBe(DEMO_TENANT.slug);
    expect(ctx.assignments.map((a) => a.roleKey).sort()).toEqual(["class_incharge", "faculty", "faculty"]);
    expect(ctx.active?.roleKey).toBe("class_incharge"); // most senior first
    const faculty = ctx.assignments.find(
      (a) => a.roleKey === "faculty" && a.orgUnitId === tree.byCode.get("CSE-3-B")!.id,
    )!;
    expect(faculty.source).toBe("teaching");
    expect(faculty.scopeMode).toBe("unit");
    expect(faculty.courseCodes).toEqual(["CS302"]);
    expect(faculty.permissions.has("student.course_attendance:read")).toBe(true);
    expect(faculty.permissions.has("student.finance:read")).toBe(false);
  });

  it("enforces HOD scope from database assignments", async () => {
    const ctx = (await loadAuthContext(db, await userId("hod_cse")))!;
    expect(canViewStudent(ctx, tree, ref("CSE-2-B"))).toBe(true);
    expect(canViewStudent(ctx, tree, ref("ECE-2-B"))).toBe(false);
    expect(studentFieldAccess(ctx, tree, ref("CSE-2-B")).finance).toBe(false);
  });

  it("resolves student and parent access through links", async () => {
    const student = (await loadAuthContext(db, await userId("student")))!;
    const parent = (await loadAuthContext(db, await userId("parent")))!;
    expect(student.links).toEqual([{ studentNumber: expect.any(String), relation: "self" }]);
    expect(parent.links[0]?.relation).toBe("guardian");
    const own = STUDENTS.find((x) => x.studentNumber === student.links[0]!.studentNumber)!;
    const ownRef = { tenantId: demoTenantId, studentNumber: own.studentNumber, sectionCode: own.sectionId };
    expect(canViewStudent(student, tree, ownRef)).toBe(true);
    expect(canViewStudent(parent, tree, ownRef)).toBe(true);
    const classmate = STUDENTS.find((x) => x.sectionId === own.sectionId && x.id !== own.id)!;
    expect(canViewStudent(student, tree, { ...ownRef, studentNumber: classmate.studentNumber })).toBe(false);
  });
});

describe("tenant isolation fails closed", () => {
  it("scopes another tenant's principal to their own tenant", async () => {
    const ctx = (await loadAuthContext(db, await userId("other_tenant_principal")))!;
    expect(ctx.tenantId).toBe(otherTenantId);
    const otherTree = await loadOrgTree(db, otherTenantId);
    expect(canViewStudent(ctx, otherTree, ref("CSE-3-A", demoTenantId))).toBe(false);
    expect(canViewStudent(ctx, tree, ref("CSE-3-A", demoTenantId))).toBe(false);
  });

  it("ignores a forged tenant preference the user has no membership in", async () => {
    const ctx = (await loadAuthContext(db, await userId("hod_cse"), { tenantId: otherTenantId }))!;
    expect(ctx.tenantId).toBe(demoTenantId);
  });

  it("ignores a forged workspace id that isn't the user's own assignment", async () => {
    const principal = (await loadAuthContext(db, await userId("principal")))!;
    const ctx = (await loadAuthContext(db, await userId("hod_cse"), {
      activeAssignmentId: principal.assignments[0]!.id,
    }))!;
    expect(ctx.active?.roleKey).toBe("hod");
  });
});

describe("role removal, expiry and suspension take effect on the next load", () => {
  it("drops a revoked assignment", async () => {
    const { userId: uid, assignmentId } = await makeUser("revoked-hod", "hod", "ECE");
    expect(canViewStudent(await loadAuthContext(db, uid), tree, ref("ECE-1-A"))).toBe(true);
    await db
      .update(s.roleAssignment)
      .set({ revokedAt: new Date(), revokeReason: "test" })
      .where(eq(s.roleAssignment.id, assignmentId));
    const after = await loadAuthContext(db, uid);
    expect(after?.assignments).toHaveLength(0);
    expect(canViewStudent(after, tree, ref("ECE-1-A"))).toBe(false);
  });

  it("excludes expired and not-yet-valid assignments", async () => {
    const expired = await makeUser("expired", "hod", "EEE", {
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
    });
    const future = await makeUser("future", "hod", "MECH", { validFrom: "2099-01-01" });
    expect((await loadAuthContext(db, expired.userId))?.assignments).toHaveLength(0);
    expect((await loadAuthContext(db, future.userId))?.assignments).toHaveLength(0);
  });

  it("returns no context at all for a suspended membership", async () => {
    const { userId: uid } = await makeUser("suspended", "faculty", "CSE-1-A");
    await db
      .update(s.tenantMembership)
      .set({ status: "suspended" })
      .where(eq(s.tenantMembership.userId, uid));
    expect(await loadAuthContext(db, uid)).toBeNull();
  });

  it("rejects incoherent validity ranges at the database", async () => {
    await expect(
      makeUser("bad-range", "hod", "CSE", { validFrom: "2026-10-10", validTo: "2026-10-01" }),
    ).rejects.toThrow();
  });
});

describe("audit trail is append-only at the database", () => {
  it("accepts inserts and rejects update, delete and truncate", async () => {
    const [row] = await db
      .insert(s.auditEvent)
      .values({ tenantId: demoTenantId, action: "test.append", outcome: "success" })
      .returning({ id: s.auditEvent.id });
    await expect(
      db.update(s.auditEvent).set({ action: "tampered" }).where(eq(s.auditEvent.id, row!.id)),
    ).rejects.toThrow();
    await expect(db.delete(s.auditEvent).where(eq(s.auditEvent.id, row!.id))).rejects.toThrow();
    await expect(db.execute(sql`truncate audit_event`)).rejects.toThrow();
    const [still] = await db
      .select({ action: s.auditEvent.action })
      .from(s.auditEvent)
      .where(eq(s.auditEvent.id, row!.id));
    expect(still?.action).toBe("test.append");
  });
});
