import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./auth";
import { student } from "./students";
import { academicYear, orgUnit, tenant } from "./tenancy";

export const membershipStatus = pgEnum("membership_status", ["active", "suspended"]);

/** A user's membership of a tenant. Suspending it blocks all access to that tenant immediately. */
export const tenantMembership = pgTable(
  "tenant_membership",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    status: membershipStatus().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("tenant_membership_user_idx").on(t.userId)],
);

/** Role definitions are data, per tenant. `rank` orders workspaces when a user holds several roles. */
export const role = pgTable(
  "role",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(""),
    rank: integer().notNull(),
    isSystem: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex("role_tenant_key_uq").on(t.tenantId, t.key)],
);

/** Global permission catalogue: "<resource>:<action>" or "<resource>.<field-class>:read". */
export const permission = pgTable("permission", {
  key: text().primaryKey(),
  description: text().notNull(),
});

export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: uuid()
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionKey: text()
      .notNull()
      .references(() => permission.key),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

/**
 * How an assignment's org unit is applied:
 *  - subtree: the unit and everything beneath it (Principal on the institution, HOD on a department)
 *  - unit:    the unit only (faculty on a specific section)
 *  - linked:  only students explicitly linked to the user (student self, parent → child)
 */
export const scopeMode = pgEnum("scope_mode", ["subtree", "unit", "linked"]);

/** user_role_assignment: one user → many role+scope pairs, effective-dated and revocable (never deleted). */
export const roleAssignment = pgTable(
  "user_role_assignment",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    roleId: uuid()
      .notNull()
      .references(() => role.id),
    orgUnitId: uuid()
      .notNull()
      .references(() => orgUnit.id),
    scopeMode: scopeMode().notNull().default("subtree"),
    /**
     * Explicit course context for a faculty-style assignment. Since Phase 2 teaching access normally derives from
     * `teaching_allocation` instead; this remains for course-scoped grants made outside an allocation.
     */
    courseCodes: text().array(),
    academicYearId: uuid().references(() => academicYear.id),
    validFrom: date()
      .notNull()
      .default(sql`current_date`),
    validTo: date(),
    grantedBy: uuid(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid(),
    revokeReason: text(),
  },
  (t) => [index("ura_user_idx").on(t.tenantId, t.userId), index("ura_org_unit_idx").on(t.orgUnitId)],
);

export const studentRelation = pgEnum("student_relation", ["self", "guardian"]);

/** Links a login to student records (student → self, parent → children) by tenant-unique student number. */
export const studentLink = pgTable(
  "user_student_link",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    studentNumber: text().notNull(),
    relation: studentRelation().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_student_link_uq").on(t.tenantId, t.userId, t.studentNumber),
    foreignKey({
      name: "user_student_link_student_fk",
      columns: [t.tenantId, t.studentNumber],
      foreignColumns: [student.tenantId, student.studentNumber],
    }),
  ],
);
