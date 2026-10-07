import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "../src/db/schema";
import { FACULTY, TERMS } from "../src/lib/demo/academics";
import {
  attendanceHistory,
  attendanceRequests,
  HOLIDAYS,
  LEAVES,
  PROGRAMME_THRESHOLDS,
} from "../src/lib/demo/attendance";
import { ATTENDANCE_THRESHOLD, studentIdFor } from "../src/lib/demo/base";
import { TIMETABLE } from "../src/lib/demo/timetable";

/*
 * Phase 3 seed: attendance policy, holidays, the current term's timetable and its attendance history, student leave
 * and pending attendance requests (lib/demo/attendance.ts). Runs as the owner. The history is created once: if the
 * tenant already has any recorded session, nothing here is rewritten, so attendance marked in the app survives.
 */

type Db = NeonHttpDatabase<typeof s>;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const instant = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

export async function seedAttendance(
  db: Db,
  tenantId: string,
  personaIds: ReadonlyMap<string, string>,
  log: (m: string) => void,
) {
  const [policy] = await db
    .insert(s.attendancePolicy)
    .values({ tenantId, thresholdPct: ATTENDANCE_THRESHOLD })
    .onConflictDoNothing()
    .returning({ tenantId: s.attendancePolicy.tenantId });
  // Programme overrides are set with the policy the first time only; later changes belong to the app.
  if (policy) {
    for (const [code, pct] of Object.entries(PROGRAMME_THRESHOLDS))
      await db
        .update(s.programme)
        .set({ attendanceThresholdPct: pct })
        .where(
          and(
            eq(s.programme.tenantId, tenantId),
            eq(s.programme.code, code),
            isNull(s.programme.attendanceThresholdPct),
          ),
        );
  }
  await db
    .insert(s.holiday)
    .values(HOLIDAYS.map((h) => ({ tenantId, ...h })))
    .onConflictDoNothing();

  const [already] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.classSession)
    .where(eq(s.classSession.tenantId, tenantId));
  if ((already?.n ?? 0) > 0) {
    log("attendance: history already present, left unchanged");
    return;
  }

  // Offerings of the current term by "SECTION/COURSE".
  const term = TERMS.find((t) => t.isCurrent)!;
  const offeringRows = await db
    .select({ id: s.courseOffering.id, sectionCode: s.orgUnit.code, courseCode: s.course.code })
    .from(s.courseOffering)
    .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseOffering.termId))
    .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
    .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.courseOffering.sectionId))
    .where(and(eq(s.courseOffering.tenantId, tenantId), eq(s.academicTerm.code, term.code)));
  const offering = new Map(offeringRows.map((o) => [`${o.sectionCode}/${o.courseCode}`, o.id]));
  const offeringId = (sectionCode: string, courseCode: string) => {
    const id = offering.get(`${sectionCode}/${courseCode}`);
    if (!id) throw new Error(`Seed: no offering ${sectionCode}/${courseCode}`);
    return id;
  };

  const facultyUsers = new Map(
    (
      await db
        .select({ id: s.appUser.id, email: s.appUser.email })
        .from(s.appUser)
        .where(
          inArray(
            s.appUser.email,
            FACULTY.map((f) => f.email),
          ),
        )
    ).map((u) => [FACULTY.find((f) => f.email === u.email)!.name, u.id]),
  );

  await db
    .insert(s.timetableSlot)
    .values(
      TIMETABLE.map((slot) => ({
        tenantId,
        offeringId: offeringId(slot.sectionCode, slot.courseCode),
        weekday: slot.weekday,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        room: slot.room,
        effectiveFrom: slot.effectiveFrom,
      })),
    )
    .onConflictDoNothing();

  const sessions: (typeof s.classSession.$inferInsert)[] = [];
  const records: (typeof s.attendanceRecord.$inferInsert)[] = [];
  for (const { session, marks } of attendanceHistory()) {
    if (!session.recorded) continue;
    const id = randomUUID();
    sessions.push({
      id,
      tenantId,
      offeringId: offeringId(session.sectionCode, session.courseCode),
      date: session.date,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      cancelReason: session.cancelReason,
      markedBy: session.facultyName ? (facultyUsers.get(session.facultyName) ?? null) : null,
      markedAt: instant(session.date, session.endsAt),
    });
    for (const [n, status] of marks)
      records.push({ tenantId, sessionId: id, studentId: studentIdFor(n), status });
  }
  for (const part of chunks(sessions, 1000)) await db.insert(s.classSession).values(part);
  for (const part of chunks(records, 5000)) await db.insert(s.attendanceRecord).values(part);

  const persona = (key: string | null) => (key ? (personaIds.get(key) ?? null) : null);
  await db.insert(s.studentLeave).values(
    LEAVES.map((l) => ({
      tenantId,
      studentId: studentIdFor(l.studentNumber),
      kind: l.kind,
      fromDate: l.fromDate,
      toDate: l.toDate,
      reason: l.reason,
      status: l.status,
      requestedBy: persona(l.requestedBy),
      requestedAt: new Date(l.requestedAt),
      decidedBy: persona(l.decidedBy),
      decidedAt: l.decidedAt ? new Date(l.decidedAt) : null,
      decisionNote: l.decisionNote,
    })),
  );

  // Totals are maintained by the app's writes; history loaded in bulk needs one full refresh.
  await db.execute(sql`select attendance_tally_refresh(null, null)`);

  const requests = attendanceRequests();
  await db.insert(s.attendanceRequest).values(
    requests.map((r) => ({
      tenantId,
      offeringId: offeringId(r.session.sectionCode, r.session.courseCode),
      date: r.session.date,
      startsAt: r.session.startsAt,
      endsAt: r.session.endsAt,
      kind: r.kind,
      proposed: {
        status: "held" as const,
        marks: Object.fromEntries(Object.entries(r.marks).map(([n, m]) => [studentIdFor(n), m])),
      },
      reason: r.reason,
      status: r.status,
      requestedBy: facultyUsers.get(r.requestedBy)!,
      requestedAt: new Date(r.requestedAt),
    })),
  );
  log(
    `attendance: ${TIMETABLE.length} timetable slots, ${sessions.length} sessions, ${records.length} marks, ${LEAVES.length} leave applications, ${requests.length} requests`,
  );
}
