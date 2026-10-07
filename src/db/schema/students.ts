import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { batch, programme, section } from "./academics";
import { appUser } from "./auth";
import { tenant } from "./tenancy";

export const studentStatus = pgEnum("student_status", [
  "active",
  "on_leave",
  "detained",
  "graduated",
  "withdrawn",
]);
export const gender = pgEnum("gender", ["F", "M", "X"]);

/**
 * The authoritative student record (PRD §5). Identity and academic placement live here; attendance, results
 * and fees attach from their own domains (Phases 3, 4, 7). Row-level security isolates tenants.
 */
export const student = pgTable(
  "student",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    /** Institution roll number, unique per tenant: "24CSE001". */
    studentNumber: text().notNull(),
    name: text().notNull(),
    gender: gender().notNull(),
    email: text().notNull(),
    phone: text().notNull(),
    programmeId: uuid()
      .notNull()
      .references(() => programme.id),
    batchId: uuid()
      .notNull()
      .references(() => batch.id),
    sectionId: uuid()
      .notNull()
      .references(() => section.orgUnitId),
    status: studentStatus().notNull().default("active"),
    admittedOn: date().notNull(),
    hosteller: boolean().notNull().default(false),
    mentorUserId: uuid().references(() => appUser.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("student_tenant_number_uq").on(t.tenantId, t.studentNumber),
    index("student_section_idx").on(t.tenantId, t.sectionId),
  ],
);

export const guardianRelation = pgEnum("guardian_relation", ["Father", "Mother", "Guardian"]);

export const guardian = pgTable(
  "guardian",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    studentId: uuid()
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    name: text().notNull(),
    relation: guardianRelation().notNull(),
    phone: text().notNull(),
    email: text(),
    isPrimary: boolean().notNull().default(false),
  },
  (t) => [index("guardian_student_idx").on(t.studentId)],
);

/**
 * Where a student sat, and why it changed: admission, transfers between sections. Closed rows have `endedOn`;
 * exactly one open row per student (partial unique index in migration 0003).
 */
export const studentSectionHistory = pgTable(
  "student_section_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    studentId: uuid()
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    sectionId: uuid()
      .notNull()
      .references(() => section.orgUnitId),
    startedOn: date().notNull(),
    endedOn: date(),
    reason: text().notNull(),
    recordedBy: uuid(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("student_section_history_student_idx").on(t.studentId)],
);
