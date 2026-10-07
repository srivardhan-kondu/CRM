import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { academicTerm, course, courseOffering } from "./academics";
import { requestStatus } from "./attendance";
import { appUser } from "./auth";
import { student } from "./students";
import { tenant } from "./tenancy";

/*
 * Assessment, examinations and results (Phase 4, ADR-021). Tenant-owned and under row-level security (migration
 * 0009). Marks are numeric with half-mark steps; maxima are stored with the rows they bound.
 */

/** Marks as numbers in TypeScript (numeric columns arrive as strings from the driver). */
const marks = () => numeric({ precision: 5, scale: 1, mode: "number" });

export const componentStatus = pgEnum("component_status", ["open", "submitted", "approved"]);

/**
 * A continuous-internal-evaluation component of an offering (IA-1, assignments…), generated from the course type's
 * scheme. The teacher enters and submits it; the HOD approves it (or returns it with a note); approved marks are
 * locked.
 */
export const assessmentComponent = pgTable(
  "assessment_component",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    offeringId: uuid()
      .notNull()
      .references(() => courseOffering.id),
    key: text().notNull(),
    label: text().notNull(),
    maxMarks: integer().notNull(),
    position: integer().notNull(),
    status: componentStatus().notNull().default("open"),
    submittedBy: uuid().references(() => appUser.id),
    submittedAt: timestamp({ withTimezone: true }),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: timestamp({ withTimezone: true }),
    returnNote: text(),
  },
  (t) => [
    uniqueIndex("assessment_component_offering_key_uq").on(t.offeringId, t.key),
    index("assessment_component_status_idx").on(t.tenantId, t.status),
    check("assessment_component_max", sql`${t.maxMarks} between 1 and 100`),
  ],
);

/** A student's marks in a component; absent students carry no marks. */
export const assessmentMark = pgTable(
  "assessment_mark",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    componentId: uuid()
      .notNull()
      .references(() => assessmentComponent.id, { onDelete: "cascade" }),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    marks: marks(),
    absent: boolean().notNull().default(false),
    enteredBy: uuid().references(() => appUser.id),
    enteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.componentId, t.studentId] }),
    index("assessment_mark_student_idx").on(t.tenantId, t.studentId),
    check(
      "assessment_mark_value",
      sql`(${t.absent} and ${t.marks} is null) or (not ${t.absent} and ${t.marks} >= 0 and ${t.marks} * 2 = round(${t.marks} * 2))`,
    ),
  ],
);

export const examKind = pgEnum("exam_kind", ["regular", "supplementary"]);
export const examStatus = pgEnum("exam_status", ["scheduled", "published"]);

/** An examination: a term's regular semester-end exams, or a supplementary sitting for backlogs. */
export const examEvent = pgTable(
  "exam_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    code: text().notNull(),
    name: text().notNull(),
    kind: examKind().notNull(),
    /** The term whose courses a regular exam examines (null for supplementary sittings). */
    termId: uuid().references(() => academicTerm.id),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    status: examStatus().notNull().default("scheduled"),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: uuid().references(() => appUser.id),
  },
  (t) => [
    uniqueIndex("exam_event_tenant_code_uq").on(t.tenantId, t.code),
    check("exam_event_dates", sql`${t.endsOn} >= ${t.startsOn}`),
    check("exam_event_published", sql`(${t.status} = 'published') = (${t.publishedAt} is not null)`),
  ],
);

export const examSession = pgEnum("exam_session", ["FN", "AN"]);

/** When a course is examined within an event (one sitting for every section). */
export const examSchedule = pgTable(
  "exam_schedule",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    eventId: uuid()
      .notNull()
      .references(() => examEvent.id, { onDelete: "cascade" }),
    courseId: uuid()
      .notNull()
      .references(() => course.id),
    date: date().notNull(),
    session: examSession().notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.courseId] })],
);

/**
 * A student sitting a course in an event, with the semester-end marks the exam cell enters. Supplementary sittings
 * carry the internal marks over from the earlier attempt.
 */
export const examRegistration = pgTable(
  "exam_registration",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    eventId: uuid()
      .notNull()
      .references(() => examEvent.id, { onDelete: "cascade" }),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    courseId: uuid()
      .notNull()
      .references(() => course.id),
    /** The term whose course this is (the original term, for a supplementary sitting). */
    termId: uuid()
      .notNull()
      .references(() => academicTerm.id),
    semester: integer().notNull(),
    cieCarried: marks(),
    seeMax: integer().notNull(),
    seeMarks: marks(),
    seeAbsent: boolean().notNull().default(false),
    enteredBy: uuid().references(() => appUser.id),
    enteredAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("exam_registration_uq").on(t.eventId, t.studentId, t.courseId),
    index("exam_registration_course_idx").on(t.eventId, t.courseId),
    index("exam_registration_student_idx").on(t.tenantId, t.studentId),
    check(
      "exam_registration_see",
      sql`(${t.seeAbsent} and ${t.seeMarks} is null) or (not ${t.seeAbsent} and (${t.seeMarks} is null or (${t.seeMarks} between 0 and ${t.seeMax} and ${t.seeMarks} * 2 = round(${t.seeMarks} * 2))))`,
    ),
  ],
);

export const resultOutcome = pgEnum("result_outcome", ["pass", "fail", "absent", "not_eligible"]);

/** A published course result: one row per attempt. CGPA and credits derive from each course's latest attempt. */
export const courseResult = pgTable(
  "course_result",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    courseId: uuid()
      .notNull()
      .references(() => course.id),
    termId: uuid()
      .notNull()
      .references(() => academicTerm.id),
    eventId: uuid()
      .notNull()
      .references(() => examEvent.id),
    semester: integer().notNull(),
    attempt: integer().notNull(),
    credits: integer().notNull(),
    cie: marks().notNull(),
    cieMax: integer().notNull(),
    see: marks(),
    seeMax: integer().notNull(),
    total: marks().notNull(),
    grade: text(),
    gradePoint: integer().notNull(),
    outcome: resultOutcome().notNull(),
    /** The SEE mark before revaluation, when revaluation raised it. */
    originalSee: marks(),
    publishedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("course_result_attempt_uq").on(t.studentId, t.courseId, t.termId, t.attempt),
    index("course_result_student_idx").on(t.tenantId, t.studentId),
    index("course_result_event_idx").on(t.eventId),
    check(
      "course_result_grade",
      sql`${t.grade} is null or ${t.grade} in ('O','A+','A','B+','B','C','P','F','Ab')`,
    ),
    check("course_result_points", sql`${t.gradePoint} between 0 and 10`),
  ],
);

/** A request to let a student in the condonation band sit the semester-end examinations. */
export const condonation = pgTable(
  "condonation",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    termId: uuid()
      .notNull()
      .references(() => academicTerm.id),
    /** Attendance when requested, for the record. */
    attendancePct: numeric({ precision: 4, scale: 1, mode: "number" }).notNull(),
    reason: text().notNull(),
    status: requestStatus().notNull().default("pending"),
    requestedBy: uuid().references(() => appUser.id),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
  },
  (t) => [
    uniqueIndex("condonation_open_uq")
      .on(t.studentId, t.termId)
      .where(sql`${t.status} in ('pending', 'approved')`),
    check(
      "condonation_decision",
      sql`(${t.status} in ('approved', 'rejected')) = (${t.decidedAt} is not null)`,
    ),
    check("condonation_no_self_approval", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
  ],
);

export const revaluationStatus = pgEnum("revaluation_status", ["pending", "completed", "withdrawn"]);

/** A student's request to re-mark a theory SEE answer script. The higher mark stands. */
export const revaluationRequest = pgTable(
  "revaluation_request",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    resultId: uuid()
      .notNull()
      .references(() => courseResult.id),
    status: revaluationStatus().notNull().default("pending"),
    requestedBy: uuid()
      .notNull()
      .references(() => appUser.id),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revaluedSee: marks(),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("revaluation_one_per_result_uq")
      .on(t.resultId)
      .where(sql`${t.status} <> 'withdrawn'`),
    check("revaluation_completed", sql`(${t.status} = 'completed') = (${t.revaluedSee} is not null)`),
  ],
);
