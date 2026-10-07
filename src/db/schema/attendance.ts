import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { courseOffering } from "./academics";
import { appUser } from "./auth";
import { student } from "./students";
import { tenant } from "./tenancy";

/*
 * Attendance and class operations (Phase 3, ADR-019). Tenant-owned and under row-level security (migration 0005).
 * Clock times are institution-local "HH:MM" text: sessions are wall-clock events in the institution's calendar.
 */

const hhmm = (column: string) => sql.raw(`${column} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`);

/** Institution-wide attendance policy. Programmes may override the threshold (programme.attendance_threshold_pct). */
export const attendancePolicy = pgTable(
  "attendance_policy",
  {
    tenantId: uuid()
      .primaryKey()
      .references(() => tenant.id),
    thresholdPct: integer().notNull().default(75),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid(),
  },
  (t) => [check("attendance_policy_threshold", sql`${t.thresholdPct} between 50 and 100`)],
);

/** A day with no teaching. Expected sessions skip holidays. */
export const holiday = pgTable(
  "holiday",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    date: date().notNull(),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [uniqueIndex("holiday_tenant_date_uq").on(t.tenantId, t.date)],
);

/** A weekly teaching slot of an offering, effective from a date (a revised timetable closes the old slot). */
export const timetableSlot = pgTable(
  "timetable_slot",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    offeringId: uuid()
      .notNull()
      .references(() => courseOffering.id),
    /** ISO weekday, 1 = Monday. */
    weekday: integer().notNull(),
    startsAt: text().notNull(),
    endsAt: text().notNull(),
    room: text().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
  },
  (t) => [
    uniqueIndex("timetable_slot_offering_uq").on(t.offeringId, t.weekday, t.startsAt, t.effectiveFrom),
    index("timetable_slot_tenant_weekday_idx").on(t.tenantId, t.weekday),
    check("timetable_slot_weekday", sql`${t.weekday} between 1 and 7`),
    check("timetable_slot_times", sql`${hhmm("starts_at")} and ${hhmm("ends_at")} and ends_at > starts_at`),
    check("timetable_slot_dates", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
  ],
);

export const sessionStatus = pgEnum("session_status", ["held", "cancelled"]);

/**
 * One meeting of an offering on a date. A row exists once the session has been marked (held, with a mark per
 * student) or recorded as not held. Scheduled sessions without a row are "not yet marked".
 */
export const classSession = pgTable(
  "class_session",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    offeringId: uuid()
      .notNull()
      .references(() => courseOffering.id),
    date: date().notNull(),
    startsAt: text().notNull(),
    endsAt: text().notNull(),
    status: sessionStatus().notNull(),
    cancelReason: text(),
    markedBy: uuid().references(() => appUser.id),
    markedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("class_session_offering_slot_uq").on(t.offeringId, t.date, t.startsAt),
    index("class_session_tenant_date_idx").on(t.tenantId, t.date),
    check("class_session_times", sql`${hhmm("starts_at")} and ${hhmm("ends_at")} and ends_at > starts_at`),
    check("class_session_cancel_reason", sql`(${t.status} = 'cancelled') = (${t.cancelReason} is not null)`),
  ],
);

export const attendanceMark = pgEnum("attendance_mark", ["present", "absent"]);

/** A student's mark in a held session. Leave never rewrites it; it is applied when attendance is read. */
export const attendanceRecord = pgTable(
  "attendance_record",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    sessionId: uuid()
      .notNull()
      .references(() => classSession.id, { onDelete: "cascade" }),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    status: attendanceMark().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.studentId] }),
    index("attendance_record_student_idx").on(t.tenantId, t.studentId),
  ],
);

export const requestStatus = pgEnum("request_status", ["pending", "approved", "rejected", "withdrawn"]);
export const leaveKind = pgEnum("leave_kind", ["od", "medical"]);

/** On-duty or medical leave of a student. Approved leave changes how absences on those days count. */
export const studentLeave = pgTable(
  "student_leave",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    kind: leaveKind().notNull(),
    fromDate: date().notNull(),
    toDate: date().notNull(),
    reason: text().notNull(),
    status: requestStatus().notNull().default("pending"),
    /** Null for an application recorded from paper by the office. */
    requestedBy: uuid().references(() => appUser.id),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
  },
  (t) => [
    index("student_leave_student_idx").on(t.tenantId, t.studentId),
    index("student_leave_pending_idx")
      .on(t.tenantId)
      .where(sql`${t.status} = 'pending'`),
    check("student_leave_dates", sql`${t.toDate} >= ${t.fromDate}`),
    check(
      "student_leave_decision",
      sql`(${t.status} in ('approved', 'rejected')) = (${t.decidedAt} is not null)`,
    ),
    check(
      "student_leave_no_self_approval",
      sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`,
    ),
  ],
);

export const attendanceRequestKind = pgEnum("attendance_request_kind", ["correction", "late_submission"]);

export interface ProposedSession {
  status: "held" | "cancelled";
  cancelReason?: string;
  /** Student id → mark (held sessions). */
  marks: Record<string, "present" | "absent">;
}

/**
 * A change to a session after its day: a correction of recorded marks, or a late submission of a session that was
 * never marked. Approval applies `proposed` through attendance_save() in the same transaction (migration 0005).
 */
export const attendanceRequest = pgTable(
  "attendance_request",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    offeringId: uuid()
      .notNull()
      .references(() => courseOffering.id),
    date: date().notNull(),
    startsAt: text().notNull(),
    endsAt: text().notNull(),
    kind: attendanceRequestKind().notNull(),
    proposed: jsonb().$type<ProposedSession>().notNull(),
    reason: text().notNull(),
    status: requestStatus().notNull().default("pending"),
    requestedBy: uuid()
      .notNull()
      .references(() => appUser.id),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
  },
  (t) => [
    uniqueIndex("attendance_request_one_pending_uq")
      .on(t.offeringId, t.date, t.startsAt)
      .where(sql`${t.status} = 'pending'`),
    index("attendance_request_tenant_status_idx").on(t.tenantId, t.status),
    check(
      "attendance_request_times",
      sql`${hhmm("starts_at")} and ${hhmm("ends_at")} and ends_at > starts_at`,
    ),
    check(
      "attendance_request_decision",
      sql`(${t.status} in ('approved', 'rejected')) = (${t.decidedAt} is not null)`,
    ),
    check(
      "attendance_request_no_self_approval",
      sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`,
    ),
  ],
);

/**
 * Maintained attendance totals per student and offering, with approved leave applied (ADR-019). Written only by
 * attendance_tally_refresh(), which attendance_save() and student_leave_decide() call in the same transaction, so
 * screens read totals without aggregating every mark on each request.
 */
export const attendanceTally = pgTable(
  "attendance_tally",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    offeringId: uuid()
      .notNull()
      .references(() => courseOffering.id),
    held: integer().notNull(),
    attended: integer().notNull(),
    od: integer().notNull(),
    excused: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.offeringId] }),
    index("attendance_tally_tenant_student_idx").on(t.tenantId, t.studentId),
  ],
);
