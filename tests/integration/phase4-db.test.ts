import { neon } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { loadComponents, loadEvents } from "@/domains/exams/load";
import { studentIdFor } from "@/lib/demo/base";
import { DEMO_TENANT, OTHER_TENANT } from "@/lib/demo/org";
import { SEED_USERS } from "@/lib/demo/personas";
import { SUPPLEMENTARY } from "@/lib/demo/results";

const db = drizzle({ client: neon(process.env.TEST_DATABASE_URL!), schema: s, casing: "snake_case" });

let demo = "";
let other = "";
let termId = "";

async function userId(key: string) {
  const email = SEED_USERS.find((u) => u.key === key)!.email.toLowerCase();
  const [row] = await db.select({ id: s.appUser.id }).from(s.appUser).where(eq(s.appUser.email, email));
  return row!.id;
}

async function failure(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

const call = (statement: ReturnType<typeof sql>) => withTenant(db, demo, (q) => [q.execute(statement)]);

async function component(sectionCode: string, courseCode: string, key: string) {
  const [rows] = await withTenant(db, demo, (q) => [
    q
      .select({ id: s.assessmentComponent.id, status: s.assessmentComponent.status })
      .from(s.assessmentComponent)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.assessmentComponent.offeringId))
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.courseOffering.sectionId))
      .where(
        and(
          eq(s.orgUnit.code, sectionCode),
          eq(s.course.code, courseCode),
          eq(s.assessmentComponent.key, key),
        ),
      ),
  ]);
  return rows[0]!;
}

beforeAll(async () => {
  const tenants = await db.select({ id: s.tenant.id, slug: s.tenant.slug }).from(s.tenant);
  demo = tenants.find((t) => t.slug === DEMO_TENANT.slug)!.id;
  other = tenants.find((t) => t.slug === OTHER_TENANT.slug)!.id;
  const [term] = await withTenant(db, demo, (q) => [
    q.select({ id: s.academicTerm.id }).from(s.academicTerm).where(eq(s.academicTerm.isCurrent, true)),
  ]);
  termId = term[0]!.id;
});

describe("examination tables under row-level security", () => {
  it("confines results, registrations and assessment to the tenant", async () => {
    const count = (tenantId: string) =>
      withTenant(db, tenantId, (q) => [
        q.select({ n: sql<number>`count(*)::int` }).from(s.courseResult),
        q.select({ n: sql<number>`count(*)::int` }).from(s.examRegistration),
        q.select({ n: sql<number>`count(*)::int` }).from(s.assessmentMark),
      ]).then((rs) => rs.map((r) => r[0]!.n));
    expect((await count(demo)).every((n) => n > 0)).toBe(true);
    expect(await count(other)).toEqual([0, 0, 0]);
  });
});

describe("internal assessment workflow", () => {
  it("submits only a complete component, and nobody moderates their own marks", async () => {
    const kavya = await userId("class_incharge");
    const hod = await userId("hod_cse");
    const c = await component("CSE-3-A", "CS302", "ia1");
    expect(c.status).toBe("open");
    const at = new Date().toISOString();
    const submit = () =>
      call(
        sql`select assessment_component_transition(${c.id}::uuid, 'open', 'submitted', ${kavya}::uuid, null, ${at}::timestamptz)`,
      );

    // Half the class is still unmarked.
    expect(await failure(submit())).toBe("23514");
    // Over the 15-mark maximum.
    const over = { [studentIdFor("24CSE014")]: { marks: 16, absent: false } };
    expect(
      await failure(
        call(
          sql`select assessment_marks_save(${c.id}::uuid, ${JSON.stringify(over)}::jsonb, ${kavya}::uuid, ${at}::timestamptz)`,
        ),
      ),
    ).toBe("23514");

    const rest = Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [
        studentIdFor(`24CSE${String(i + 1).padStart(3, "0")}`),
        { marks: 11.5, absent: false },
      ]),
    );
    await call(
      sql`select assessment_marks_save(${c.id}::uuid, ${JSON.stringify(rest)}::jsonb, ${kavya}::uuid, ${at}::timestamptz)`,
    );
    await submit();

    const moderate = (by: string) =>
      call(
        sql`select assessment_component_transition(${c.id}::uuid, 'submitted', 'approved', ${by}::uuid, null, ${at}::timestamptz)`,
      );
    expect(await failure(moderate(kavya))).toBe("42501");
    await moderate(hod);
    expect(await failure(moderate(hod))).toBe("55000");
    // Approved marks are locked.
    expect(
      await failure(
        call(
          sql`select assessment_marks_save(${c.id}::uuid, ${JSON.stringify(rest)}::jsonb, ${kavya}::uuid, ${at}::timestamptz)`,
        ),
      ),
    ).toBe("55000");

    const after = await loadComponents(db, demo, termId);
    expect(after.find((x) => x.id === c.id)).toMatchObject({ status: "approved", entries: 14 });
  });
});

describe("examinations", () => {
  it("publishes an event once", async () => {
    const coe = await userId("exam_controller");
    const supp = (await loadEvents(db, demo)).find((e) => e.code === SUPPLEMENTARY.code)!;
    expect(supp.status).toBe("scheduled");
    const publish = () => call(sql`select exam_event_publish(${supp.id}::uuid, ${coe}::uuid, now())`);
    await publish();
    expect(await failure(publish())).toBe("55000");
    // Published marks no longer change through mark entry.
    expect(
      await failure(
        call(
          sql`select exam_marks_save(${supp.id}::uuid, ${supp.id}::uuid, '{}'::jsonb, ${coe}::uuid, now())`,
        ),
      ),
    ).toBe("55000");
  });

  it("will not let a condonation requester decide it", async () => {
    const kavya = await userId("class_incharge");
    const id = crypto.randomUUID();
    await withTenant(db, demo, (q) => [
      q.insert(s.condonation).values({
        id,
        tenantId: demo,
        studentId: studentIdFor("24CSE013"),
        termId,
        attendancePct: 70,
        reason: "Integration test: requester may not decide.",
        requestedBy: kavya,
      }),
    ]);
    expect(
      await failure(
        call(sql`select condonation_decide(${id}::uuid, 'approved', ${kavya}::uuid, null, now())`),
      ),
    ).toBe("23514");
  });
});
