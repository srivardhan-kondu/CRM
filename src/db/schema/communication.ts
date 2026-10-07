import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import type { AudienceRule } from "@/domains/announcements/types";
import { appUser } from "./auth";
import { student } from "./students";
import { orgUnit, tenant } from "./tenancy";

/*
 * Campus Communication Hub (Phase 5, ADR-023). Tenant-owned and under row-level security (migration 0012).
 */

export const announcementStatus = pgEnum("announcement_status", [
  "draft",
  "pending",
  "published",
  "rejected",
  "withdrawn",
]);
export const announcementCategory = pgEnum("announcement_category", [
  "academic",
  "examinations",
  "results",
  "placement",
  "internships",
  "scholarships",
  "administrative",
  "events",
  "compliance",
  "emergency",
  "general",
]);
export const announcementSeverity = pgEnum("announcement_severity", ["critical", "high", "normal", "low"]);

/**
 * A notice: draft → (pending →) published → withdrawn, or pending → rejected → draft. `audience` is the rule;
 * `audienceUnitId` is the unit it is aimed at, where publishing and approval are authorized. Published content is
 * frozen by trigger: a correction is a withdrawal and a new notice.
 */
export const announcement = pgTable(
  "announcement",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    /** Stable key for seeded notices, so re-seeding never duplicates them. */
    seedKey: text(),
    title: text().notNull(),
    summary: text().notNull(),
    body: text().notNull(),
    category: announcementCategory().notNull(),
    severity: announcementSeverity().notNull(),
    audience: jsonb().$type<AudienceRule>().notNull(),
    audienceLabel: text().notNull(),
    audienceUnitId: uuid()
      .notNull()
      .references(() => orgUnit.id),
    requiresAck: boolean().notNull().default(false),
    sendEmail: boolean().notNull().default(false),
    deadline: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    /** Module from a later phase this notice points to ("Register" → placements), shown disabled until then. */
    ctaLabel: text(),
    ctaPhase: integer(),
    status: announcementStatus().notNull().default("draft"),
    /** Null for notices from offices without an account (seeded "Accounts Office"). */
    authorId: uuid().references(() => appUser.id),
    authorName: text().notNull(),
    authorRole: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    withdrawnBy: uuid().references(() => appUser.id),
    withdrawnAt: timestamp({ withTimezone: true }),
    withdrawReason: text(),
    remindedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("announcement_seed_key_uq").on(t.tenantId, t.seedKey),
    index("announcement_status_idx").on(t.tenantId, t.status, t.publishedAt),
    index("announcement_author_idx").on(t.tenantId, t.authorId),
    check(
      "announcement_published",
      sql`(${t.status} in ('published', 'withdrawn')) = (${t.publishedAt} is not null)`,
    ),
    check("announcement_no_self_approval", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.authorId}`),
    check(
      "announcement_expiry",
      sql`${t.expiresAt} is null or ${t.publishedAt} is null or ${t.expiresAt} > ${t.publishedAt}`,
    ),
  ],
);

/**
 * A file attached to a notice. Content is stored base64 in the row (≤ 2 MB, type checked by its bytes) and is served
 * only through the permission-checked download route — there is no public URL to leak.
 */
export const announcementAttachment = pgTable(
  "announcement_attachment",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    announcementId: uuid()
      .notNull()
      .references(() => announcement.id, { onDelete: "cascade" }),
    fileName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    sha256: text().notNull(),
    contentBase64: text().notNull(),
    uploadedBy: uuid().references(() => appUser.id),
    uploadedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("announcement_attachment_announcement_idx").on(t.announcementId),
    check("announcement_attachment_size", sql`${t.sizeBytes} between 1 and 2097152`),
  ],
);

export const recipientKind = pgEnum("recipient_kind", ["student", "guardian", "staff"]);

/**
 * One recipient of a published notice. Students and guardian households (keyed by student) are resolved when the
 * notice is published, so reach and acknowledgement are measured against who was addressed at that moment; staff
 * receipts are created when a staff recipient first opens or acknowledges it.
 * recipient_key: "s:<student id>" | "g:<student id>" | "u:<user id>".
 */
export const announcementReceipt = pgTable(
  "announcement_receipt",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    announcementId: uuid()
      .notNull()
      .references(() => announcement.id, { onDelete: "cascade" }),
    recipientKey: text().notNull(),
    kind: recipientKind().notNull(),
    studentId: uuid().references(() => student.id),
    userId: uuid().references(() => appUser.id),
    deliveredAt: timestamp({ withTimezone: true }).notNull(),
    readAt: timestamp({ withTimezone: true }),
    acknowledgedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.announcementId, t.recipientKey] }),
    index("announcement_receipt_student_idx").on(t.tenantId, t.studentId),
    index("announcement_receipt_user_idx").on(t.tenantId, t.userId),
    check(
      "announcement_receipt_recipient",
      sql`(${t.kind} = 'staff' and ${t.userId} is not null) or (${t.kind} <> 'staff' and ${t.studentId} is not null)`,
    ),
    check("announcement_receipt_ack", sql`${t.acknowledgedAt} is null or ${t.readAt} is not null`),
  ],
);

export const announcementBookmark = pgTable(
  "announcement_bookmark",
  {
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    announcementId: uuid()
      .notNull()
      .references(() => announcement.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] })],
);

export const messageTemplate = pgEnum("message_template", [
  "attendance_shortage",
  "exam_eligibility",
  "meeting",
  "general",
]);

/**
 * A message to one student's guardians, rendered from a template with that student's figures. Guardians read and
 * acknowledge it in the app (and may reply once); it is also emailed to the primary guardian through the outbox.
 */
export const guardianMessage = pgTable(
  "guardian_message",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    studentId: uuid()
      .notNull()
      .references(() => student.id),
    /** Messages sent together (one per student) share a batch. */
    batchId: uuid().notNull(),
    template: messageTemplate().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    senderId: uuid()
      .notNull()
      .references(() => appUser.id),
    senderName: text().notNull(),
    senderRole: text().notNull(),
    sentAt: timestamp({ withTimezone: true }).notNull(),
    readAt: timestamp({ withTimezone: true }),
    acknowledgedAt: timestamp({ withTimezone: true }),
    acknowledgedBy: uuid().references(() => appUser.id),
    reply: text(),
  },
  (t) => [
    index("guardian_message_student_idx").on(t.tenantId, t.studentId, t.sentAt),
    index("guardian_message_sender_idx").on(t.tenantId, t.senderId),
    check(
      "guardian_message_ack",
      sql`(${t.acknowledgedAt} is null) = (${t.acknowledgedBy} is null) and (${t.reply} is null or ${t.acknowledgedAt} is not null)`,
    ),
  ],
);

export const notificationChannel = pgEnum("notification_channel", ["email"]);
export const outboxStatus = pgEnum("outbox_status", ["queued", "held", "sent", "failed", "suppressed"]);
export const outboxSource = pgEnum("outbox_source", ["announcement", "reminder", "guardian_message"]);

/**
 * Every external message, before and after it leaves. `notBefore` carries quiet hours: a held message is released by
 * the dispatcher at 07:00. `suppressed` records a recipient with no address, so gaps in contact data are visible.
 */
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    channel: notificationChannel().notNull().default("email"),
    recipientKind: recipientKind().notNull(),
    studentId: uuid().references(() => student.id),
    userId: uuid().references(() => appUser.id),
    toName: text().notNull(),
    toAddress: text(),
    subject: text().notNull(),
    body: text().notNull(),
    sourceType: outboxSource().notNull(),
    sourceId: uuid().notNull(),
    status: outboxStatus().notNull(),
    notBefore: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    sentAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
    transport: text(),
  },
  (t) => [
    index("notification_outbox_due_idx").on(t.tenantId, t.status, t.notBefore),
    index("notification_outbox_source_idx").on(t.tenantId, t.sourceType, t.sourceId),
    check("notification_outbox_address", sql`${t.status} = 'suppressed' or ${t.toAddress} is not null`),
    check("notification_outbox_sent", sql`(${t.status} = 'sent') = (${t.sentAt} is not null)`),
  ],
);

/** A personal in-app notification (the bell): a decision on your request, a reply to your message. */
export const userNotification = pgTable(
  "user_notification",
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenant.id),
    userId: uuid()
      .notNull()
      .references(() => appUser.id),
    kind: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    href: text(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    readAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("user_notification_user_idx").on(t.tenantId, t.userId, t.createdAt)],
);
