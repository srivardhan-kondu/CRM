import { neon } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { loadOfferingPlanInputs, loadProgrammes, loadTerms } from "@/domains/academics/load";
import { planOfferings } from "@/domains/academics/plan";
import { loadPlacement, loadStudentById, loadStudents } from "@/domains/students/load";
import { studentScope } from "@/domains/students/scope";
import { studentFieldAccess } from "@/lib/authz/engine";
import { loadAuthContext, loadOrgTree } from "@/lib/authz/load";
import type { OrgTree } from "@/lib/authz/types";
import { REGULATIONS } from "@/lib/demo/academics";
import { STUDENTS } from "@/lib/demo/fixtures";
import { DEMO_TENANT, OTHER_TENANT } from "@/lib/demo/org";
import { SEED_USERS } from "@/lib/demo/personas";

const db = drizzle({ client: neon(process.env.TEST_DATABASE_URL!), schema: s, casing: "snake_case" });

let demo = "";
let other = "";
let tree: OrgTree;

async function userId(key: string) {
  const email = SEED_USERS.find((u) => u.key === key)!.email.toLowerCase();
  const [row] = await db.select({ id: s.appUser.id }).from(s.appUser).where(eq(s.appUser.email, email));
  return row!.id;
}

beforeAll(async () => {
  const tenants = await db.select({ id: s.tenant.id, slug: s.tenant.slug }).from(s.tenant);
  demo = tenants.find((t) => t.slug === DEMO_TENANT.slug)!.id;
  other = tenants.find((t) => t.slug === OTHER_TENANT.slug)!.id;
  tree = await loadOrgTree(db, demo);
});

const countStudents = (tenantId: string) =>
  withTenant(db, tenantId, (q) => [q.select({ n: sql<number>`count(*)::int` }).from(s.student)]).then(
    ([rows]) => rows[0]!.n,
  );

describe("row-level security on business tables", () => {
  it("confines the application role to the tenant set for the transaction", async () => {
    expect(await countStudents(demo)).toBe(STUDENTS.length);
    expect(await countStudents(other)).toBe(0);
  });

  it("returns nothing when no tenant is set, even with no WHERE clause", async () => {
    const [, rows] = await db.batch([
      db.execute(sql`select set_config('role', 'campusos_app', true)`),
      db.select({ n: sql<number>`count(*)::int` }).from(s.student),
    ]);
    expect(rows[0]!.n).toBe(0);
  });

  it("rejects writing a row into another tenant", async () => {
    const [programme] = await db
      .select({ id: s.programme.id, departmentId: s.programme.departmentId })
      .from(s.programme)
      .where(eq(s.programme.tenantId, demo))
      .limit(1);
    await expect(
      withTenant(db, other, (q) => [
        q.insert(s.curriculum).values({
          tenantId: demo,
          programmeId: programme!.id,
          code: "R99",
          name: "Forged",
          effectiveFromYear: 2099,
        }),
      ]),
    ).rejects.toThrow();
  });

  it("cannot update the audit trail or touch identity tables as the application role", async () => {
    await expect(
      withTenant(db, demo, (q) => [q.update(s.auditEvent).set({ action: "tampered" })]),
    ).rejects.toThrow();
    await expect(
      withTenant(db, demo, (q) => [q.select({ p: s.authAccount.password }).from(s.authAccount)]),
    ).rejects.toThrow();
  });
});

describe("regulations", () => {
  it("freezes the course list of a published regulation", async () => {
    const [published] = await withTenant(db, demo, (q) => [
      q.select({ id: s.curriculum.id }).from(s.curriculum).where(eq(s.curriculum.status, "active")).limit(1),
    ]);
    const [course] = await db
      .select({ id: s.course.id })
      .from(s.course)
      .where(eq(s.course.tenantId, demo))
      .limit(1);
    const error = await withTenant(db, demo, (q) => [
      q.insert(s.curriculumCourse).values({
        tenantId: demo,
        curriculumId: published[0]!.id,
        courseId: course!.id,
        semester: 1,
        category: "elective",
      }),
    ]).then(
      () => null,
      (e: unknown) => e,
    );
    // Drizzle wraps driver errors; the trigger's message is on the error or its cause.
    expect(String(error) + String((error as { cause?: unknown } | null)?.cause)).toMatch(/only draft/);
  });

  it("seeds every regulation with its programme's batches pinned correctly", async () => {
    const programmes = await loadProgrammes(db, demo);
    expect(programmes.flatMap((p) => p.regulations)).toHaveLength(REGULATIONS.length);
    const cse = programmes.find((p) => p.code === "BTECH-CSE")!;
    expect(cse.regulations.map((r) => `${r.code}:${r.status}`)).toEqual([
      "R22:active",
      "R24:active",
      "R26:draft",
    ]);
    expect(cse.batches.find((b) => b.admissionYear === 2023)?.regulationCode).toBe("R22");
    expect(cse.batches.find((b) => b.admissionYear === 2024)?.regulationCode).toBe("R24");
    expect(cse.students).toBe(STUDENTS.filter((x) => x.departmentCode === "CSE").length);
  });
});

describe("terms and offerings", () => {
  it("has one current term and nothing left to generate for it", async () => {
    const terms = await loadTerms(db, demo);
    const current = terms.filter((t) => t.isCurrent);
    expect(current).toHaveLength(1);
    const inputs = await loadOfferingPlanInputs(db, demo, current[0]!.id);
    expect(planOfferings({ term: current[0]!, ...inputs })).toEqual([]);
  });

  it("plans the even term from each batch's regulation", async () => {
    // The current year's even term (past terms exist since Phase 4, with their own cohorts).
    const even = (await loadTerms(db, demo)).find((t) => t.code === "2026-27-EVEN")!;
    const plan = planOfferings({ term: even, ...(await loadOfferingPlanInputs(db, demo, even.id)) });
    // Every section continues into its next semester; graduating batches have semester 8 courses.
    expect(new Set(plan.map((p) => p.sectionId)).size).toBe(
      [...tree.byId.values()].filter((u) => u.type === "section").length,
    );
    expect(plan.every((p) => p.semester % 2 === 0)).toBe(true);
  });
});

describe("students from the database", () => {
  it("assembles the same students the in-memory twin describes", async () => {
    const principal = (await loadAuthContext(db, await userId("principal")))!;
    const bundle = await loadStudents(db, demo, studentScope(principal, tree));
    expect(bundle.students).toHaveLength(STUDENTS.length);
    const byId = new Map(bundle.students.map((x) => [x.id, x]));
    for (const fixture of STUDENTS.filter((_, i) => i % 17 === 0))
      expect(byId.get(fixture.id)).toEqual(fixture);
  });

  it("loads only the prefiltered sections for a scoped user, and the engine agrees", async () => {
    const faculty = (await loadAuthContext(db, await userId("faculty")))!;
    const bundle = await loadStudents(db, demo, studentScope(faculty, tree));
    expect(new Set(bundle.students.map((x) => x.sectionId))).toEqual(new Set(["CSE-3-A", "CSE-3-B"]));
    for (const st of bundle.students) {
      const access = studentFieldAccess(faculty, tree, {
        tenantId: demo,
        studentNumber: st.studentNumber,
        sectionCode: st.sectionId,
      });
      expect(access.view).toBe(true);
      expect(access.courseAttendance).toEqual(["CS301"]);
    }
  });

  it("shows placement with this term's courses and who teaches them", async () => {
    const st = STUDENTS.find((x) => x.sectionId === "CSE-3-A")!;
    const bundle = await loadStudentById(db, demo, st.id);
    const placement = await loadPlacement(db, demo, bundle.rows.get(st.id)!);
    expect(placement.regulationCode).toBe("R24");
    expect(placement.courses.find((c) => c.code === "CS301")?.faculty).toEqual(["Mr. Rahul Verma"]);
    expect(placement.history).toHaveLength(1);
    expect(placement.history[0]!.reason).toBe("Admission");
  });

  it("links persona logins to real student rows", async () => {
    const links = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.studentLink)
      .leftJoin(
        s.student,
        and(
          eq(s.student.tenantId, s.studentLink.tenantId),
          eq(s.student.studentNumber, s.studentLink.studentNumber),
        ),
      )
      .where(sql`${s.student.id} is null`);
    expect(links[0]!.n).toBe(0);
  });
});

describe("teaching allocation drives access", () => {
  it("removes a faculty member's access when their allocation is removed", async () => {
    const uid = await userId("faculty");
    const before = (await loadAuthContext(db, uid))!;
    expect(before.assignments.map((a) => tree.byId.get(a.orgUnitId)?.code)).toEqual(["CSE-3-A", "CSE-3-B"]);

    const [alloc] = await withTenant(db, demo, (q) => [
      q
        .select({ id: s.teachingAllocation.id, offeringId: s.teachingAllocation.offeringId })
        .from(s.teachingAllocation)
        .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.teachingAllocation.offeringId))
        .where(
          and(
            eq(s.teachingAllocation.userId, uid),
            eq(s.courseOffering.sectionId, tree.byCode.get("CSE-3-B")!.id),
          ),
        ),
    ]);
    await withTenant(db, demo, (q) => [
      q
        .update(s.teachingAllocation)
        .set({ removedAt: new Date(), removeReason: "test" })
        .where(eq(s.teachingAllocation.id, alloc[0]!.id)),
    ]);
    const after = (await loadAuthContext(db, uid))!;
    expect(after.assignments.map((a) => tree.byId.get(a.orgUnitId)?.code)).toEqual(["CSE-3-A"]);
    // Restore so other suites see the seeded state.
    await withTenant(db, demo, (q) => [
      q
        .insert(s.teachingAllocation)
        .values({ tenantId: demo, offeringId: alloc[0]!.offeringId, userId: uid }),
    ]);
  });

  it("gives nothing to another tenant's users", async () => {
    const ctx = (await loadAuthContext(db, await userId("other_tenant_principal")))!;
    expect(ctx.tenantId).toBe(other);
    expect((await loadProgrammes(db, other)).length).toBe(0);
  });
});
