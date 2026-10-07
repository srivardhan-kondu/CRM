import { aliasedTable, and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { DEFAULT_THRESHOLD_PCT, type Mark, type Tally } from "./rules";
import type { SlotRef } from "./schedule";

/*
 * Attendance loaders: Next-agnostic (integration tests call them directly), always under RLS via withTenant.
 */

type Db = NeonHttpDatabase<typeof s>;

const marker = aliasedTable(s.appUser, "marker");
const requester = aliasedTable(s.appUser, "requester");
const decider = aliasedTable(s.appUser, "decider");
const sectionUnit = aliasedTable(s.orgUnit, "section_unit");

/* ---------- Policy and calendar ---------- */

export function policyQuery(q: Db) {
  return q.select({ thresholdPct: s.attendancePolicy.thresholdPct }).from(s.attendancePolicy);
}

export async function loadPolicy(db: Db, tenantId: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [policyQuery(q)]);
  return { thresholdPct: rows[0]?.thresholdPct ?? DEFAULT_THRESHOLD_PCT };
}

export async function loadHolidays(db: Db, tenantId: string, from: string, to: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({ id: s.holiday.id, date: s.holiday.date, name: s.holiday.name })
      .from(s.holiday)
      .where(and(gte(s.holiday.date, from), lte(s.holiday.date, to)))
      .orderBy(asc(s.holiday.date)),
  ]);
  return rows;
}

/** A term's timetable: every slot of its offerings. */
export async function loadSlots(db: Db, tenantId: string, termId: string): Promise<SlotRef[]> {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.timetableSlot.id,
        offeringId: s.timetableSlot.offeringId,
        weekday: s.timetableSlot.weekday,
        startsAt: s.timetableSlot.startsAt,
        endsAt: s.timetableSlot.endsAt,
        room: s.timetableSlot.room,
        effectiveFrom: s.timetableSlot.effectiveFrom,
        effectiveTo: s.timetableSlot.effectiveTo,
      })
      .from(s.timetableSlot)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.timetableSlot.offeringId))
      .where(eq(s.courseOffering.termId, termId))
      .orderBy(asc(s.timetableSlot.weekday), asc(s.timetableSlot.startsAt)),
  ]);
  return rows;
}

/* ---------- Sessions ---------- */

export interface SessionFilter {
  offeringIds?: readonly string[];
  from?: string;
  to?: string;
}

/** Recorded sessions with their present/absent counts. */
export async function loadSessions(db: Db, tenantId: string, filter: SessionFilter) {
  if (filter.offeringIds && filter.offeringIds.length === 0) return [];
  const where = and(
    filter.offeringIds ? inArray(s.classSession.offeringId, [...filter.offeringIds]) : undefined,
    filter.from ? gte(s.classSession.date, filter.from) : undefined,
    filter.to ? lte(s.classSession.date, filter.to) : undefined,
  );
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.classSession.id,
        offeringId: s.classSession.offeringId,
        date: s.classSession.date,
        startsAt: s.classSession.startsAt,
        endsAt: s.classSession.endsAt,
        status: s.classSession.status,
        cancelReason: s.classSession.cancelReason,
        markedBy: marker.name,
        markedAt: s.classSession.markedAt,
        present: sql<number>`(count(${s.attendanceRecord.studentId}) filter (where ${s.attendanceRecord.status} = 'present'))::int`,
        absent: sql<number>`(count(${s.attendanceRecord.studentId}) filter (where ${s.attendanceRecord.status} = 'absent'))::int`,
      })
      .from(s.classSession)
      .leftJoin(marker, eq(marker.id, s.classSession.markedBy))
      .leftJoin(s.attendanceRecord, eq(s.attendanceRecord.sessionId, s.classSession.id))
      .where(where)
      .groupBy(s.classSession.id, marker.name)
      .orderBy(desc(s.classSession.date), desc(s.classSession.startsAt)),
  ]);
  return rows;
}

export type SessionRow = Awaited<ReturnType<typeof loadSessions>>[number];

/** One session's marks by student id (empty when it was not recorded or not held). */
export async function loadSessionMarks(
  db: Db,
  tenantId: string,
  key: { offeringId: string; date: string; startsAt: string },
) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({ studentId: s.attendanceRecord.studentId, status: s.attendanceRecord.status })
      .from(s.attendanceRecord)
      .innerJoin(s.classSession, eq(s.classSession.id, s.attendanceRecord.sessionId))
      .where(
        and(
          eq(s.classSession.offeringId, key.offeringId),
          eq(s.classSession.date, key.date),
          eq(s.classSession.startsAt, key.startsAt),
        ),
      ),
  ]);
  return new Map<string, Mark>(rows.map((r) => [r.studentId, r.status]));
}

/** Students on a section's roll on a date (section history), in roll-number order. */
export async function loadRoll(db: Db, tenantId: string, sectionId: string, date: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.student.id,
        studentNumber: s.student.studentNumber,
        name: s.student.name,
        status: s.student.status,
        sectionCode: sql<string>`(select code from org_unit where id = ${s.student.sectionId})`,
      })
      .from(s.studentSectionHistory)
      .innerJoin(s.student, eq(s.student.id, s.studentSectionHistory.studentId))
      .where(
        and(
          eq(s.studentSectionHistory.sectionId, sectionId),
          lte(s.studentSectionHistory.startedOn, date),
          sql`(${s.studentSectionHistory.endedOn} is null or ${s.studentSectionHistory.endedOn} >= ${date})`,
        ),
      )
      .orderBy(asc(s.student.studentNumber)),
  ]);
  return rows;
}

/* ---------- Tallies ---------- */

/**
 * Current-term attendance per student and course, with approved leave applied (rules.ts): an absence on an approved
 * OD day counts as attended, on an approved medical day it leaves the denominator. Reads the totals the database
 * maintains (attendance_tally, refreshed whenever a session is saved or leave is approved). `studentWhere` filters on
 * `student` columns (scope). Meant to run inside a caller's withTenant batch.
 */
export function tallyQuery(q: Db, studentWhere: SQL) {
  return (
    q
      .select({
        studentId: s.attendanceTally.studentId,
        courseCode: s.course.code,
        held: sql<number>`sum(${s.attendanceTally.held})::int`,
        attended: sql<number>`sum(${s.attendanceTally.attended})::int`,
        od: sql<number>`sum(${s.attendanceTally.od})::int`,
        excused: sql<number>`sum(${s.attendanceTally.excused})::int`,
      })
      .from(s.attendanceTally)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.attendanceTally.offeringId))
      .innerJoin(
        s.academicTerm,
        and(eq(s.academicTerm.id, s.courseOffering.termId), eq(s.academicTerm.isCurrent, true)),
      )
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.student, eq(s.student.id, s.attendanceTally.studentId))
      .where(studentWhere)
      // A student moved between sections has a tally per offering; a course is one subject for them.
      .groupBy(s.attendanceTally.studentId, s.course.code)
  );
}

/** Tally rows → student id → course code → tally. */
export function talliesByStudent(rows: Awaited<ReturnType<typeof tallyQuery>>) {
  const out = new Map<string, Map<string, Tally>>();
  for (const r of rows) {
    const byCourse = out.get(r.studentId) ?? new Map<string, Tally>();
    byCourse.set(r.courseCode, { held: r.held, attended: r.attended, od: r.od, excused: r.excused });
    out.set(r.studentId, byCourse);
  }
  return out;
}

/** A student's recent current-term sessions, newest first, with the mark and any approved leave that day. */
export async function loadStudentLog(db: Db, tenantId: string, studentId: string, limit = 40) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        date: s.classSession.date,
        startsAt: s.classSession.startsAt,
        courseCode: s.course.code,
        courseName: s.course.name,
        mark: s.attendanceRecord.status,
        leave: sql<"od" | "medical" | null>`(
          select case when bool_or(l.kind = 'od') then 'od' else 'medical' end
          from student_leave l
          where l.student_id = ${s.attendanceRecord.studentId}
            and l.status = 'approved'
            and ${s.classSession.date} between l.from_date and l.to_date
          having count(*) > 0)`,
      })
      .from(s.attendanceRecord)
      .innerJoin(
        s.classSession,
        and(eq(s.classSession.id, s.attendanceRecord.sessionId), eq(s.classSession.status, "held")),
      )
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.classSession.offeringId))
      .innerJoin(
        s.academicTerm,
        and(eq(s.academicTerm.id, s.courseOffering.termId), eq(s.academicTerm.isCurrent, true)),
      )
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .where(eq(s.attendanceRecord.studentId, studentId))
      .orderBy(desc(s.classSession.date), desc(s.classSession.startsAt))
      .limit(limit),
  ]);
  return rows;
}

/* ---------- Leave ---------- */

export interface LeaveFilter {
  studentIds?: readonly string[];
  status?: "pending";
  ids?: readonly string[];
}

export async function loadLeaves(db: Db, tenantId: string, filter: LeaveFilter = {}) {
  if (filter.studentIds && filter.studentIds.length === 0) return [];
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.studentLeave.id,
        studentId: s.studentLeave.studentId,
        studentNumber: s.student.studentNumber,
        studentName: s.student.name,
        sectionId: s.student.sectionId,
        sectionCode: sectionUnit.code,
        sectionLabel: s.section.label,
        kind: s.studentLeave.kind,
        fromDate: s.studentLeave.fromDate,
        toDate: s.studentLeave.toDate,
        reason: s.studentLeave.reason,
        status: s.studentLeave.status,
        requestedById: s.studentLeave.requestedBy,
        requestedBy: requester.name,
        requestedAt: s.studentLeave.requestedAt,
        decidedById: s.studentLeave.decidedBy,
        decidedBy: decider.name,
        decidedAt: s.studentLeave.decidedAt,
        decisionNote: s.studentLeave.decisionNote,
      })
      .from(s.studentLeave)
      .innerJoin(s.student, eq(s.student.id, s.studentLeave.studentId))
      .innerJoin(s.section, eq(s.section.orgUnitId, s.student.sectionId))
      .innerJoin(sectionUnit, eq(sectionUnit.id, s.student.sectionId))
      .leftJoin(requester, eq(requester.id, s.studentLeave.requestedBy))
      .leftJoin(decider, eq(decider.id, s.studentLeave.decidedBy))
      .where(
        and(
          filter.studentIds ? inArray(s.studentLeave.studentId, [...filter.studentIds]) : undefined,
          filter.ids ? inArray(s.studentLeave.id, [...filter.ids]) : undefined,
          filter.status ? eq(s.studentLeave.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(s.studentLeave.requestedAt)),
  ]);
  return rows;
}

export type LeaveRow = Awaited<ReturnType<typeof loadLeaves>>[number];

/* ---------- Attendance requests ---------- */

export interface RequestFilter {
  status?: "pending";
  ids?: readonly string[];
  requestedBy?: string;
  /** Requests decided since this instant, in addition to whatever else matches. */
  limit?: number;
}

export async function loadRequests(db: Db, tenantId: string, filter: RequestFilter = {}) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.attendanceRequest.id,
        offeringId: s.attendanceRequest.offeringId,
        sectionId: s.courseOffering.sectionId,
        sectionCode: sectionUnit.code,
        sectionLabel: s.section.label,
        courseCode: s.course.code,
        courseName: s.course.name,
        date: s.attendanceRequest.date,
        startsAt: s.attendanceRequest.startsAt,
        endsAt: s.attendanceRequest.endsAt,
        kind: s.attendanceRequest.kind,
        proposed: s.attendanceRequest.proposed,
        reason: s.attendanceRequest.reason,
        status: s.attendanceRequest.status,
        requestedById: s.attendanceRequest.requestedBy,
        requestedBy: requester.name,
        requestedAt: s.attendanceRequest.requestedAt,
        decidedById: s.attendanceRequest.decidedBy,
        decidedBy: decider.name,
        decidedAt: s.attendanceRequest.decidedAt,
        decisionNote: s.attendanceRequest.decisionNote,
      })
      .from(s.attendanceRequest)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.attendanceRequest.offeringId))
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.section, eq(s.section.orgUnitId, s.courseOffering.sectionId))
      .innerJoin(sectionUnit, eq(sectionUnit.id, s.courseOffering.sectionId))
      // requested_by is NOT NULL, so a left join returns the same rows. (An inner join here next to the left-joined
      // decider alias collapses Drizzle's inferred row type to never.)
      .leftJoin(requester, eq(requester.id, s.attendanceRequest.requestedBy))
      .leftJoin(decider, eq(decider.id, s.attendanceRequest.decidedBy))
      .where(
        and(
          filter.status ? eq(s.attendanceRequest.status, filter.status) : undefined,
          filter.ids ? inArray(s.attendanceRequest.id, [...filter.ids]) : undefined,
          filter.requestedBy ? eq(s.attendanceRequest.requestedBy, filter.requestedBy) : undefined,
        ),
      )
      .orderBy(desc(s.attendanceRequest.requestedAt))
      .limit(filter.limit ?? 500),
  ]);
  return rows.map((r) => ({ ...r, requestedBy: r.requestedBy ?? "Former user" }));
}

export type RequestRow = Awaited<ReturnType<typeof loadRequests>>[number];
