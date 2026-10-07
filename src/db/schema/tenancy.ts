import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const tenantStatus = pgEnum("tenant_status", ["active", "suspended"]);

/** Institution or group account. Every tenant-owned row carries tenant_id. */
export const tenant = pgTable("tenant", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  status: tenantStatus().notNull().default("active"),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const orgUnitType = pgEnum("org_unit_type", [
  "institution",
  "campus",
  "school",
  "department",
  "section",
  "office",
]);

/**
 * Generic hierarchy node (PRD §10): institution → campus → school → department → section, plus offices
 * (placement cell, exam unit, hostel…). Campus is an org_unit of type "campus".
 *
 * `path` is a materialised ancestor path of ids ("/<root>/<campus>/…/<self>/") so "is A an ancestor of B"
 * is a prefix test, in SQL or in memory. Programmes, batches and sections' academic meaning live in academics.ts;
 * a section's identity is its org unit.
 */
export const orgUnit = pgTable(
  "org_unit",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    parentId: uuid().references((): AnyPgColumn => orgUnit.id),
    type: orgUnitType().notNull(),
    /** Stable human code, unique per tenant: "CSE", "CSE-3-A", "TECH". */
    code: text().notNull(),
    name: text().notNull(),
    path: text().notNull(),
    depth: integer().notNull(),
    validFrom: date()
      .notNull()
      .default(sql`current_date`),
    validTo: date(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("org_unit_tenant_code_uq").on(t.tenantId, t.code),
    index("org_unit_tenant_path_idx").on(t.tenantId, t.path),
    index("org_unit_parent_idx").on(t.parentId),
  ],
);

export const academicYear = pgTable(
  "academic_year",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    code: text().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    isCurrent: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("academic_year_tenant_code_uq").on(t.tenantId, t.code)],
);
