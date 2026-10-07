import { neon } from "@neondatabase/serverless";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  loadRequests,
  loadSessionMarks,
  loadSessions,
  talliesByStudent,
  tallyQuery,
} from "@/domains/attendance/load";
import { correctionStudents } from "@/lib/demo/attendance";
import { studentIdFor } from "@/lib/demo/base";
import { DEMO_TENANT, OTHER_TENANT } from "@/lib/demo/org";
import { SEED_USERS } from "@/lib/demo/personas";

const db = drizzle({ client: neon(process.env.TEST_DATABASE_URL!), schema: s, casing: "snake_case" });

let demo = "";
let other = "";

async function userId(key: string) {
  const email = SEED_USERS.find((u) => u.key === key)!.email.toLowerCase();
  const [row] = await db.select({ id: s.appUser.id }).from(s.appUser).where(eq(s.appUser.email, email));
  return row!.id;
}

/** Postgres SQLSTATE of a failed call, possibly wrapped by Drizzle. */
async function failure(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code ?? "unknown";
  }
}

async function offeringId(sectionCode: string, courseCode: string) {
  const [rows] = await withTenant(db, demo, (q) => [
    q
      .select({ id: s.courseOffering.id })
      .from(s.courseOffering)
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.courseOffering.sectionId))
      .where(and(eq(s.orgUnit.code, sectionCode), eq(s.course.code, courseCode))),
  ]);
  return rows[0]!.id;
}

const save = (offering: string, date: string, start: string, end: string, proposed: object, by: string) =>
  withTenant(db, demo, (q) => [
    q.execute(
      sql`select attendance_save(${offering}::uuid, ${date}::date, ${start}, ${end}, ${JSON.stringify(proposed)}::jsonb, ${by}::uuid, now())`,
    ),
  ]);

const decide = (
  fn: "attendance_request_decide" | "student_leave_decide",
  id: string,
  decision: string,
  by: string,
) =>
  withTenant(db, demo, (q) => [
    q.execute(sql`select ${sql.raw(fn)}(${id}::uuid, ${decision}::request_status, ${by}::uuid, null, now())`),
  ]);

beforeAll(async () => {
  const tenants = await db.select({ id: s.tenant.id, slug: s.tenant.slug }).from(s.tenant);
  demo = tenants.find((t) => t.slug === DEMO_TENANT.slug)!.id;
  other = tenants.find((t) => t.slug === OTHER_TENANT.slug)!.id;
});

describe("attendance tables under row-level security", () => {
  it("confines sessions, marks, leave and requests to the transaction's tenant", async () => {
    const count = (tenantId: string) =>
      withTenant(db, tenantId, (q) => [
        q.select({ n: sql<number>`count(*)::int` }).from(s.classSession),
        q.select({ n: sql<number>`count(*)::int` }).from(s.attendanceRecord),
        q.select({ n: sql<number>`count(*)::int` }).from(s.studentLeave),
        q.select({ n: sql<number>`count(*)::int` }).from(s.attendanceRequest),
      ]).then((rs) => rs.map((r) => r[0]!.n));
    const mine = await count(demo);
    expect(mine.every((n) => n > 0)).toBe(true);
    expect(await count(other)).toEqual([0, 0, 0, 0]);
  });
});

describe("attendance_save", () => {
  it("records a session and refuses a mark for a student who is not on the section's roll", async () => {
    const kavya = await userId("class_incharge");
    const cs301 = await offeringId("CSE-3-A", "CS301");
    const roll = Array.from({ length: 14 }, (_, i) => studentIdFor(`24CSE${String(i + 1).padStart(3, "0")}`));
    const marks = Object.fromEntries(roll.map((id) => [id, "present"]));
    await save(cs301, "2026-10-06", "09:00", "09:55", { status: "held", marks }, kavya);
    const [session] = await loadSessions(db, demo, {
      offeringIds: [cs301],
      from: "2026-10-06",
      to: "2026-10-06",
    });
    expect(session).toMatchObject({ status: "held", present: 14, absent: 0 });

    // 24CSE015 sits in 3-CSE-B.
    const outsider = { ...marks, [studentIdFor("24CSE015")]: "absent" };
    expect(
      await failure(save(cs301, "2026-10-06", "09:00", "09:55", { status: "held", marks: outsider }, kavya)),
    ).toBe("23514");
    expect(
      await failure(save(cs301, "2026-10-06", "09:00", "09:55", { status: "cancelled", marks: {} }, kavya)),
    ).toBe("23514");
  });
});

describe("deciding requests", () => {
  it("applies an approved correction once, and refuses a second decision", async () => {
    const hod = await userId("hod_cse");
    const [correction] = (await loadRequests(db, demo, { status: "pending" })).filter(
      (r) => r.kind === "correction",
    );
    expect(correction).toBeDefined();
    const before = await loadSessionMarks(db, demo, correction!);
    for (const n of correctionStudents()) expect(before.get(studentIdFor(n))).toBe("absent");

    await decide("attendance_request_decide", correction!.id, "approved", hod);
    const after = await loadSessionMarks(db, demo, correction!);
    for (const n of correctionStudents()) expect(after.get(studentIdFor(n))).toBe("present");
    expect(await failure(decide("attendance_request_decide", correction!.id, "rejected", hod))).toBe("55000");
  });

  it("will not let a requester approve their own request", async () => {
    const [late] = (await loadRequests(db, demo, { status: "pending" })).filter(
      (r) => r.kind === "late_submission",
    );
    expect(
      await failure(decide("attendance_request_decide", late!.id, "approved", late!.requestedById)),
    ).toBe("23514");
  });

  it("counts a student's medical leave as excused once it is approved", async () => {
    const kavya = await userId("class_incharge");
    const student = studentIdFor("24CSE001");
    const tally = async () => {
      const [rows] = await withTenant(db, demo, (q) => [tallyQuery(q, eq(s.student.id, student))]);
      const byCourse = talliesByStudent(rows).get(student)!;
      return [...byCourse.values()].reduce(
        (n, t) => ({ held: n.held + t.held, excused: n.excused + t.excused }),
        { held: 0, excused: 0 },
      );
    };
    const before = await tally();
    const [leaves] = await withTenant(db, demo, (q) => [
      q
        .select({ id: s.studentLeave.id })
        .from(s.studentLeave)
        .where(and(eq(s.studentLeave.studentId, student), eq(s.studentLeave.status, "pending"))),
    ]);
    await decide("student_leave_decide", leaves[0]!.id, "approved", kavya);
    const after = await tally();
    expect(after.excused).toBeGreaterThan(before.excused);
    expect(after.held).toBe(before.held - (after.excused - before.excused));
  });
});
