import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./auth";
import { academicYear, orgUnit, tenant } from "./tenancy";

/*
 * Academic structure (PRD §10, Phase 2). Every table is tenant-owned and protected by row-level security
 * (migration 0003): the app reads and writes them as `campusos_app` with `app.tenant_id` set per transaction.
 *
 * Curriculum versioning is "regulation per programme" (ADR-015): a programme has named regulations (R22, R24);
 * an admission batch is pinned to one; an active regulation's course list is frozen.
 */

export const termKind = pgEnum("term_kind", ["odd", "even", "summer"]);

/** A teaching term inside an academic year. Exactly one per tenant is current (partial unique index). */
export const academicTerm = pgTable(
  "academic_term",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYear.id),
    /** "2026-27-ODD" */
    code: text().notNull(),
    name: text().notNull(),
    kind: termKind().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    isCurrent: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex("academic_term_tenant_code_uq").on(t.tenantId, t.code),
    uniqueIndex("academic_term_one_current_uq")
      .on(t.tenantId)
      .where(sql`${t.isCurrent}`),
  ],
);

export const programmeLevel = pgEnum("programme_level", ["ug", "pg", "diploma", "doctoral"]);

/** A degree programme offered by a department: "B.Tech CSE", "MBA". */
export const programme = pgTable(
  "programme",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    departmentId: uuid()
      .notNull()
      .references(() => orgUnit.id),
    /** "BTECH-CSE" */
    code: text().notNull(),
    name: text().notNull(),
    level: programmeLevel().notNull(),
    durationYears: integer().notNull(),
    semesters: integer().notNull(),
    /** Attendance shortage threshold for this programme; null follows the institution policy (Phase 3). */
    attendanceThresholdPct: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("programme_tenant_code_uq").on(t.tenantId, t.code),
    check(
      "programme_attendance_threshold",
      sql`${t.attendanceThresholdPct} is null or ${t.attendanceThresholdPct} between 50 and 100`,
    ),
  ],
);

export const curriculumStatus = pgEnum("curriculum_status", ["draft", "active", "retired"]);

/**
 * A regulation (curriculum version) of a programme. Drafts are editable; publishing freezes the course list;
 * retiring stops new batches from adopting it while existing batches keep it.
 */
export const curriculum = pgTable(
  "curriculum",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    programmeId: uuid()
      .notNull()
      .references(() => programme.id),
    /** "R24" */
    code: text().notNull(),
    name: text().notNull(),
    status: curriculumStatus().notNull().default("draft"),
    /** First admission year expected to follow this regulation (informational). */
    effectiveFromYear: integer().notNull(),
    derivedFromId: uuid(),
    publishedAt: timestamp({ withTimezone: true }),
    publishedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [
    uniqueIndex("curriculum_programme_code_uq").on(t.tenantId, t.programmeId, t.code),
    // Target for batch's composite FK: a batch's regulation must belong to the batch's programme.
    unique("curriculum_id_programme_uq").on(t.id, t.programmeId),
  ],
);

export const courseType = pgEnum("course_type", ["theory", "lab", "project"]);

/** Course catalogue entry. Owned by an org unit (a department, or a school for shared foundation courses). */
export const course = pgTable(
  "course",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    ownerUnitId: uuid()
      .notNull()
      .references(() => orgUnit.id),
    /** "CS301" */
    code: text().notNull(),
    name: text().notNull(),
    type: courseType().notNull(),
    credits: integer().notNull(),
    lectureHours: integer().notNull().default(0),
    tutorialHours: integer().notNull().default(0),
    practicalHours: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("course_tenant_code_uq").on(t.tenantId, t.code)],
);

export const courseCategory = pgEnum("course_category", ["core", "elective", "lab", "project", "foundation"]);

/** Which course a regulation places in which semester. */
export const curriculumCourse = pgTable(
  "curriculum_course",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    curriculumId: uuid()
      .notNull()
      .references(() => curriculum.id, { onDelete: "cascade" }),
    courseId: uuid()
      .notNull()
      .references(() => course.id),
    semester: integer().notNull(),
    category: courseCategory().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.curriculumId, t.courseId] }),
    index("curriculum_course_semester_idx").on(t.curriculumId, t.semester),
  ],
);

/** An admission cohort of a programme, pinned to one regulation: "B.Tech CSE 2024–28" on R24. */
export const batch = pgTable(
  "batch",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    programmeId: uuid()
      .notNull()
      .references(() => programme.id),
    curriculumId: uuid().notNull(),
    /** "BTECH-CSE-2024" */
    code: text().notNull(),
    name: text().notNull(),
    admissionYear: integer().notNull(),
    graduationYear: integer().notNull(),
  },
  (t) => [
    uniqueIndex("batch_tenant_code_uq").on(t.tenantId, t.code),
    foreignKey({
      name: "batch_curriculum_programme_fk",
      columns: [t.curriculumId, t.programmeId],
      foreignColumns: [curriculum.id, curriculum.programmeId],
    }),
  ],
);

/**
 * A teaching section of a batch. Its identity is the `org_unit` of type "section", so authorization scopes
 * (class incharge on 3-CSE-A) and academic structure refer to the same node.
 */
export const section = pgTable(
  "section",
  {
    orgUnitId: uuid()
      .primaryKey()
      .references(() => orgUnit.id),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    batchId: uuid()
      .notNull()
      .references(() => batch.id),
    letter: text().notNull(),
    /** How the college writes it: "3-CSE-A". */
    label: text().notNull(),
  },
  (t) => [uniqueIndex("section_batch_letter_uq").on(t.batchId, t.letter)],
);

export const offeringStatus = pgEnum("offering_status", ["planned", "active", "completed"]);

/** A course taught to a section in a term. Generated from the batch's regulation. */
export const courseOffering = pgTable(
  "course_offering",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    termId: uuid()
      .notNull()
      .references(() => academicTerm.id),
    courseId: uuid()
      .notNull()
      .references(() => course.id),
    sectionId: uuid()
      .notNull()
      .references(() => section.orgUnitId),
    status: offeringStatus().notNull().default("planned"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("course_offering_term_course_section_uq").on(t.termId, t.courseId, t.sectionId),
    index("course_offering_section_idx").on(t.tenantId, t.sectionId),
  ],
);

export const teachingRole = pgEnum("teaching_role", ["primary", "co_teacher", "lab"]);

/**
 * Who teaches an offering. An active allocation is what gives a faculty member access to that section's
 * students for that course (the authz loader derives a unit-scoped faculty assignment from it). Removed, never
 * deleted, so history is reproducible.
 */
export const teachingAllocation = pgTable(
  "teaching_allocation",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    offeringId: uuid()
      .notNull()
      .references(() => courseOffering.id),
    userId: uuid()
      .notNull()
      .references(() => appUser.id),
    role: teachingRole().notNull().default("primary"),
    allocatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    allocatedBy: uuid(),
    removedAt: timestamp({ withTimezone: true }),
    removedBy: uuid(),
    removeReason: text(),
  },
  (t) => [
    uniqueIndex("teaching_allocation_active_uq")
      .on(t.offeringId, t.userId)
      .where(sql`${t.removedAt} is null`),
    index("teaching_allocation_user_idx").on(t.tenantId, t.userId),
  ],
);

export const facultyStatus = pgEnum("faculty_status", ["active", "on_leave", "relieved"]);

/** Staff profile for a member who teaches. Home department decides who may see it. */
export const facultyProfile = pgTable(
  "faculty_profile",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    userId: uuid()
      .notNull()
      .references(() => appUser.id),
    employeeCode: text().notNull(),
    designation: text().notNull(),
    departmentId: uuid()
      .notNull()
      .references(() => orgUnit.id),
    status: facultyStatus().notNull().default("active"),
    /** Contact hours per week the department plans against. */
    maxWeeklyHours: integer().notNull().default(16),
    joinedOn: date(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    uniqueIndex("faculty_profile_employee_code_uq").on(t.tenantId, t.employeeCode),
    index("faculty_profile_department_idx").on(t.tenantId, t.departmentId),
  ],
);
