import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auditOutcome = pgEnum("audit_outcome", ["success", "denied", "failure"]);

/**
 * Append-only audit trail (PRD §4, §16). UPDATE/DELETE/TRUNCATE are rejected by trigger (migration 0001).
 * No foreign keys: the record must outlive the users and resources it describes.
 */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid(),
    actorEmail: text(),
    action: text().notNull(),
    resourceType: text(),
    resourceId: text(),
    outcome: auditOutcome().notNull(),
    reason: text(),
    ipAddress: text(),
    userAgent: text(),
    metadata: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("audit_event_tenant_time_idx").on(t.tenantId, t.occurredAt.desc()),
    index("audit_event_actor_idx").on(t.actorUserId, t.occurredAt.desc()),
    index("audit_event_resource_idx").on(t.resourceType, t.resourceId),
  ],
);
