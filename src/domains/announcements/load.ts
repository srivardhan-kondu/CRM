import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { parseSectionCode } from "@/lib/authz/org-tree";
import type { Announcement, AnnouncementStatus, AttachmentMeta } from "./types";

/*
 * Announcement loaders: Next-agnostic (integration tests call them directly) and always under RLS via withTenant.
 */

type Db = NeonHttpDatabase<typeof s>;

const columns = {
  id: s.announcement.id,
  title: s.announcement.title,
  summary: s.announcement.summary,
  body: s.announcement.body,
  category: s.announcement.category,
  severity: s.announcement.severity,
  audience: s.announcement.audience,
  audienceLabel: s.announcement.audienceLabel,
  audienceUnitId: s.announcement.audienceUnitId,
  requiresAck: s.announcement.requiresAck,
  sendEmail: s.announcement.sendEmail,
  deadline: s.announcement.deadline,
  expiresAt: s.announcement.expiresAt,
  ctaLabel: s.announcement.ctaLabel,
  ctaPhase: s.announcement.ctaPhase,
  status: s.announcement.status,
  authorId: s.announcement.authorId,
  authorName: s.announcement.authorName,
  authorRole: s.announcement.authorRole,
  createdAt: s.announcement.createdAt,
  submittedAt: s.announcement.submittedAt,
  publishedAt: s.announcement.publishedAt,
  decidedBy: s.announcement.decidedBy,
  decidedAt: s.announcement.decidedAt,
  decisionNote: s.announcement.decisionNote,
  withdrawnAt: s.announcement.withdrawnAt,
  withdrawReason: s.announcement.withdrawReason,
  remindedAt: s.announcement.remindedAt,
};

function announcementQuery(q: Db) {
  return q.select(columns).from(s.announcement);
}

type Row = Awaited<ReturnType<typeof announcementQuery>>[number];

function attachmentQuery(q: Db) {
  return q
    .select({
      id: s.announcementAttachment.id,
      announcementId: s.announcementAttachment.announcementId,
      name: s.announcementAttachment.fileName,
      contentType: s.announcementAttachment.contentType,
      sizeBytes: s.announcementAttachment.sizeBytes,
    })
    .from(s.announcementAttachment);
}

export interface AnnouncementRecord extends Announcement {
  createdAt: string;
  submittedAt: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  remindedAt: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toRecord(row: Row, attachments: AttachmentMeta[]): AnnouncementRecord {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body.split(/\n{2,}/).filter((p) => p.trim().length > 0),
    category: row.category,
    severity: row.severity,
    author: row.authorName,
    authorRole: row.authorRole,
    authorId: row.authorId,
    status: row.status,
    // Drafts and pending notices have no publication time; they sort by when they were written.
    publishedAt: (row.publishedAt ?? row.submittedAt ?? row.createdAt).toISOString(),
    expiresAt: iso(row.expiresAt),
    deadline: iso(row.deadline),
    requiresAck: row.requiresAck,
    sendEmail: row.sendEmail,
    audience: row.audience,
    audienceLabel: row.audienceLabel,
    audienceUnitId: row.audienceUnitId,
    attachments,
    cta: row.ctaLabel && row.ctaPhase ? { label: row.ctaLabel, phase: row.ctaPhase } : null,
    createdAt: row.createdAt.toISOString(),
    submittedAt: iso(row.submittedAt),
    decidedById: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    withdrawnAt: iso(row.withdrawnAt),
    withdrawReason: row.withdrawReason,
    remindedAt: iso(row.remindedAt),
  };
}

async function load(db: Db, tenantId: string, where: SQL) {
  const [rows, files] = await withTenant(db, tenantId, (q) => [
    announcementQuery(q)
      .where(where)
      .orderBy(desc(s.announcement.publishedAt), desc(s.announcement.createdAt)),
    attachmentQuery(q)
      .innerJoin(s.announcement, eq(s.announcement.id, s.announcementAttachment.announcementId))
      .where(where)
      .orderBy(asc(s.announcementAttachment.uploadedAt), asc(s.announcementAttachment.fileName)),
  ]);
  const byNotice = new Map<string, AttachmentMeta[]>();
  for (const { announcementId, ...f } of files) {
    const list = byNotice.get(announcementId) ?? [];
    list.push(f);
    byNotice.set(announcementId, list);
  }
  return rows.map((r) => toRecord(r, byNotice.get(r.id) ?? []));
}

/** Every published notice of the tenant (expired ones included, for History). */
export function loadPublished(db: Db, tenantId: string) {
  return load(db, tenantId, eq(s.announcement.status, "published"));
}

export function loadByStatus(db: Db, tenantId: string, status: AnnouncementStatus) {
  return load(db, tenantId, eq(s.announcement.status, status));
}

/** Everything a user has written, in any state. */
export function loadAuthored(db: Db, tenantId: string, userId: string) {
  return load(db, tenantId, eq(s.announcement.authorId, userId));
}

export async function loadAnnouncement(db: Db, tenantId: string, id: string) {
  return (await load(db, tenantId, eq(s.announcement.id, id)))[0] ?? null;
}

export interface ReceiptRow {
  announcementId: string;
  recipientKey: string;
  readAt: Date | null;
  acknowledgedAt: Date | null;
}

/** The viewer's receipts across notices, by recipient key ("s:…", "g:…", "u:…"). */
export async function loadReceipts(db: Db, tenantId: string, keys: readonly string[]): Promise<ReceiptRow[]> {
  if (keys.length === 0) return [];
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        announcementId: s.announcementReceipt.announcementId,
        recipientKey: s.announcementReceipt.recipientKey,
        readAt: s.announcementReceipt.readAt,
        acknowledgedAt: s.announcementReceipt.acknowledgedAt,
      })
      .from(s.announcementReceipt)
      .where(inArray(s.announcementReceipt.recipientKey, [...keys])),
  ]);
  return rows;
}

export async function loadBookmarks(db: Db, tenantId: string, userId: string): Promise<Set<string>> {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({ id: s.announcementBookmark.announcementId })
      .from(s.announcementBookmark)
      .where(eq(s.announcementBookmark.userId, userId)),
  ]);
  return new Set(rows.map((r) => r.id));
}

/** A student as a potential recipient: placement for targeting, addresses for email. */
export interface RecipientStudent {
  id: string;
  studentNumber: string;
  name: string;
  email: string;
  sectionId: string;
  departmentCode: string;
  year: number;
  guardianName: string | null;
  guardianEmail: string | null;
}

/** Enrolled students (not graduated or withdrawn) with their primary guardian. */
export async function loadRecipientStudents(db: Db, tenantId: string): Promise<RecipientStudent[]> {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.student.id,
        studentNumber: s.student.studentNumber,
        name: s.student.name,
        email: s.student.email,
        sectionCode: s.orgUnit.code,
        guardianName: s.guardian.name,
        guardianEmail: s.guardian.email,
      })
      .from(s.student)
      .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.student.sectionId))
      .leftJoin(s.guardian, and(eq(s.guardian.studentId, s.student.id), eq(s.guardian.isPrimary, true)))
      .where(inArray(s.student.status, ["active", "on_leave", "detained"]))
      .orderBy(asc(s.student.studentNumber)),
  ]);
  return rows.flatMap((r) => {
    const placement = parseSectionCode(r.sectionCode);
    if (!placement) return [];
    return [
      {
        id: r.id,
        studentNumber: r.studentNumber,
        name: r.name,
        email: r.email,
        sectionId: r.sectionCode,
        departmentCode: placement.departmentCode,
        year: placement.year,
        guardianName: r.guardianName,
        guardianEmail: r.guardianEmail,
      },
    ];
  });
}

export interface EngagementRow {
  kind: "student" | "guardian" | "staff";
  sectionCode: string | null;
  delivered: number;
  read: number;
  acknowledged: number;
}

/** Receipts of one notice, counted by recipient kind and section. */
export async function loadEngagement(db: Db, tenantId: string, announcementId: string, pendingLimit = 400) {
  const [rows, pending, outbox] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        kind: s.announcementReceipt.kind,
        sectionCode: s.orgUnit.code,
        delivered: sql<number>`count(*)::int`,
        read: sql<number>`count(${s.announcementReceipt.readAt})::int`,
        acknowledged: sql<number>`count(${s.announcementReceipt.acknowledgedAt})::int`,
      })
      .from(s.announcementReceipt)
      .leftJoin(s.student, eq(s.student.id, s.announcementReceipt.studentId))
      .leftJoin(s.orgUnit, eq(s.orgUnit.id, s.student.sectionId))
      .where(eq(s.announcementReceipt.announcementId, announcementId))
      .groupBy(s.announcementReceipt.kind, s.orgUnit.code),
    // Students (and households) yet to acknowledge, for a named follow-up list on small audiences.
    q
      .select({
        kind: s.announcementReceipt.kind,
        studentId: s.student.id,
        studentNumber: s.student.studentNumber,
        name: s.student.name,
        sectionCode: s.orgUnit.code,
        read: sql<boolean>`${s.announcementReceipt.readAt} is not null`,
      })
      .from(s.announcementReceipt)
      .innerJoin(s.student, eq(s.student.id, s.announcementReceipt.studentId))
      .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.student.sectionId))
      .where(
        and(
          eq(s.announcementReceipt.announcementId, announcementId),
          sql`${s.announcementReceipt.acknowledgedAt} is null`,
        ),
      )
      .orderBy(asc(s.student.studentNumber))
      .limit(pendingLimit),
    q
      .select({ status: s.notificationOutbox.status, n: sql<number>`count(*)::int` })
      .from(s.notificationOutbox)
      .where(
        and(
          inArray(s.notificationOutbox.sourceType, ["announcement", "reminder"]),
          eq(s.notificationOutbox.sourceId, announcementId),
        ),
      )
      .groupBy(s.notificationOutbox.status),
  ]);
  return {
    rows: rows as EngagementRow[],
    pending,
    email: Object.fromEntries(outbox.map((o) => [o.status, o.n])) as Partial<
      Record<(typeof outbox)[number]["status"], number>
    >,
  };
}

export type Engagement = Awaited<ReturnType<typeof loadEngagement>>;

/** One attachment with its content, for the download route. */
export async function loadAttachment(db: Db, tenantId: string, announcementId: string, attachmentId: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.announcementAttachment.id,
        fileName: s.announcementAttachment.fileName,
        contentType: s.announcementAttachment.contentType,
        sizeBytes: s.announcementAttachment.sizeBytes,
        sha256: s.announcementAttachment.sha256,
        contentBase64: s.announcementAttachment.contentBase64,
      })
      .from(s.announcementAttachment)
      .where(
        and(
          eq(s.announcementAttachment.id, attachmentId),
          eq(s.announcementAttachment.announcementId, announcementId),
        ),
      ),
  ]);
  return rows[0] ?? null;
}
