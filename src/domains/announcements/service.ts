import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { notificationRows, outboxRows, type OutgoingEmail } from "@/domains/notifications/outbox";
import { denied, fail, successAudit, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import { env } from "@/lib/env";
import { authorityAt, canApprove, canManageNotice } from "./guards";
import { loadAnnouncement, loadEngagement, type AnnouncementRecord, type RecipientStudent } from "./load";
import { getInboxItem, myKeysFor, receiptValues, recipientStudents, ruleFromKey } from "./repository";
import {
  audienceLabel,
  audienceUnit,
  canRemind,
  checkAttachment,
  LIMITS,
  publishRoute,
  safeFileName,
} from "./rules";
import { AUDIENCE_GROUPS, CATEGORIES, SEVERITIES } from "./types";
import { includes, targetsStudent } from "./visibility";

/*
 * Announcement mutations. Each authorizes with the guards and the publishing policy (rules.ts), validates, then writes
 * the change, its consequences (recipients, outbox, notifications) and its audit event in one transaction under RLS.
 * State changes go through announcement_transition() (migration 0012), which locks and re-checks.
 */

type Db = ReturnType<typeof getDb>;
type Statements = [BatchItem<"pg">, ...BatchItem<"pg">[]];

function run(authed: Authed, statements: (q: Db) => Statements) {
  return withTenant(getDb(), authed.ctx.tenantId, statements);
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

function transitionError(err: unknown): ActionResult | null {
  const code = pgCode(err);
  if (code === "55000") return fail("This notice has changed in the meantime — reload and check.");
  if (code === "42501") return fail("You can't decide your own notice.");
  return null;
}

const transition = (q: Db, id: string, to: string, by: string, note: string | null, at: Date) =>
  q.execute(
    sql`select announcement_transition(${id}::uuid, ${to}::announcement_status, ${by}::uuid, ${note}, ${at.toISOString()}::timestamptz)`,
  );

/** A local date-time from the form ("2026-10-12T17:00") read as institution time. */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => new Date(`${v}:00+05:30`));

const optionalDateTime = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  localDateTime.optional(),
);

const noticeSchema = z
  .object({
    id: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.uuid().optional()),
    intent: z.enum(["draft", "send"]),
    title: z.string().trim().min(5, "Give the notice a title.").max(LIMITS.title),
    summary: z.string().trim().min(10, "Write a one-line summary.").max(LIMITS.summary),
    body: z.string().trim().max(LIMITS.body).default(""),
    category: z.enum(CATEGORIES),
    severity: z.enum(SEVERITIES),
    target: z.string().min(1).max(80),
    audience: z.enum(AUDIENCE_GROUPS),
    deadline: optionalDateTime,
    expiresAt: optionalDateTime,
    requiresAck: z.boolean(),
    sendEmail: z.boolean(),
    removeAttachments: z.array(z.uuid()).max(LIMITS.attachments).default([]),
  })
  .refine((d) => !d.deadline || !d.expiresAt || d.deadline <= d.expiresAt, {
    message: "The action deadline must fall before the notice expires.",
  });

export interface NewAttachment {
  name: string;
  type: string;
  bytes: Uint8Array;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || env().BETTER_AUTH_URL).replace(/\/$/, "");
}

/** Email for one notice recipient: the summary and a link — the notice itself is read in the app. */
type NoticeCore = Pick<
  AnnouncementRecord,
  "id" | "title" | "summary" | "requiresAck" | "author" | "severity" | "sendEmail" | "audience"
>;

function noticeEmail(a: NoticeCore, reminder: boolean) {
  const link = `${appUrl()}/announcements?view=mine&id=${a.id}`;
  return {
    subject: `${reminder ? "Reminder: " : ""}${a.title}`,
    body: `${a.summary}\n\n${a.requiresAck ? "Read and acknowledge" : "Read"} the full notice from ${a.author}: ${link}`,
  };
}

/**
 * Recipients resolved at publication: one receipt per targeted student and per guardian household, and — when the
 * notice goes by email too — one outbox row per recipient (held during quiet hours unless critical).
 */
function fanOut(
  q: Db,
  authed: Authed,
  a: NoticeCore,
  students: readonly RecipientStudent[],
  at: Date,
): BatchItem<"pg">[] {
  const targeted = students.filter((st) => targetsStudent(a.audience, st));
  const toStudents = includes(a.audience, "students") ? targeted : [];
  const toGuardians = includes(a.audience, "guardians")
    ? targeted.filter((st) => st.guardianName !== null)
    : [];
  const receipts = [
    ...toStudents.map((st) => receiptValues(authed, a.id, `s:${st.id}`, at, {})),
    ...toGuardians.map((st) => receiptValues(authed, a.id, `g:${st.id}`, at, {})),
  ];
  const out: BatchItem<"pg">[] = [];
  for (let i = 0; i < receipts.length; i += 1000)
    out.push(
      q
        .insert(s.announcementReceipt)
        .values(receipts.slice(i, i + 1000))
        .onConflictDoNothing(),
    );
  if (a.sendEmail) {
    const { subject, body } = noticeEmail(a, false);
    const emails: OutgoingEmail[] = [
      ...toStudents.map((st) => ({
        recipientKind: "student" as const,
        studentId: st.id,
        toName: st.name,
        toAddress: st.email,
        subject,
        body,
      })),
      ...toGuardians.map((st) => ({
        recipientKind: "guardian" as const,
        studentId: st.id,
        toName: st.guardianName!,
        toAddress: st.guardianEmail,
        subject,
        body,
      })),
    ];
    const rows = outboxRows(
      authed.ctx.tenantId,
      { type: "announcement", id: a.id },
      emails,
      at,
      a.severity === "critical",
    );
    for (let i = 0; i < rows.length; i += 500)
      out.push(q.insert(s.notificationOutbox).values(rows.slice(i, i + 500)));
  }
  return out;
}

function authorRole(authed: Authed): string {
  return authed.ctx.active?.roleName ?? "Staff";
}

export async function saveNotice(
  authed: Authed,
  input: unknown,
  files: NewAttachment[],
): Promise<ActionResult> {
  const parsed = noticeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the notice and try again.");
  const d = parsed.data;
  const { ctx, tree } = authed;
  const now = institutionNow();

  const rule = ruleFromKey(d.target, d.audience);
  const unit = rule && audienceUnit(rule, tree);
  if (!rule || !unit) return fail("Choose who the notice is for.");
  if (d.expiresAt && d.expiresAt <= now) return fail("The expiry must be in the future.");
  if (d.deadline && d.deadline <= now) return fail("The action deadline must be in the future.");
  if (d.sendEmail && !includes(rule, "students") && !includes(rule, "guardians"))
    return fail("Email goes to students and guardians; staff notices are in-app only.");

  const authority = authorityAt(ctx, tree, unit.id);
  const route = publishRoute(rule, d.severity, authority);
  if (route.kind === "denied") return denied(authed, "announcement.save", "announcement", route.reason, d.id);

  let existing: AnnouncementRecord | null = null;
  if (d.id) {
    existing = await loadAnnouncement(getDb(), ctx.tenantId, d.id);
    if (!existing || existing.authorId !== ctx.userId) return fail("Unknown draft.");
    if (existing.status !== "draft" && existing.status !== "rejected")
      return fail("Only drafts can be edited — withdraw a published notice and issue a new one.");
  }

  // Attachments: what stays, what is added; each new file checked by its bytes.
  const kept = (existing?.attachments ?? []).filter((f) => !d.removeAttachments.includes(f.id));
  if (kept.length + files.length > LIMITS.attachments)
    return fail(`Attach at most ${LIMITS.attachments} files.`);
  if (files.reduce((n, f) => n + f.bytes.length, 0) > LIMITS.uploadBytes)
    return fail("Add at most 4 MB of files at a time — save the draft, then add the rest.");
  for (const f of files) {
    const check = checkAttachment(f.name, f.type, f.bytes);
    if (!check.ok) return fail(check.reason);
  }

  const id = existing?.id ?? crypto.randomUUID();
  const content = {
    title: d.title,
    summary: d.summary,
    body: d.body,
    category: d.category,
    severity: d.severity,
    audience: rule,
    audienceLabel: audienceLabel(rule, tree),
    audienceUnitId: unit.id,
    requiresAck: d.requiresAck,
    sendEmail: d.sendEmail,
    deadline: d.deadline ?? null,
    expiresAt: d.expiresAt ?? null,
    updatedAt: now,
  };
  const outcome = d.intent === "draft" ? "draft" : route.kind === "direct" ? "published" : "pending";
  const action =
    outcome === "draft"
      ? "announcement.save_draft"
      : outcome === "published"
        ? "announcement.publish"
        : "announcement.submit";
  const students = outcome === "published" ? await recipientStudents(authed) : [];
  const audit = await successAudit(authed, action, "announcement", id, {
    title: d.title,
    audience: content.audienceLabel,
    severity: d.severity,
    attachments: kept.length + files.length,
  });

  try {
    await run(authed, (q) => {
      const statements: BatchItem<"pg">[] = [];
      if (existing?.status === "rejected") statements.push(transition(q, id, "draft", ctx.userId, null, now));
      statements.push(
        existing
          ? q.update(s.announcement).set(content).where(eq(s.announcement.id, id))
          : q.insert(s.announcement).values({
              id,
              tenantId: ctx.tenantId,
              ...content,
              authorId: ctx.userId,
              authorName: ctx.name,
              authorRole: authorRole(authed),
              createdAt: now,
            }),
      );
      if (d.removeAttachments.length > 0)
        statements.push(
          q
            .delete(s.announcementAttachment)
            .where(
              and(
                eq(s.announcementAttachment.announcementId, id),
                inArray(s.announcementAttachment.id, d.removeAttachments),
              ),
            ),
        );
      for (const f of files)
        statements.push(
          q.insert(s.announcementAttachment).values({
            tenantId: ctx.tenantId,
            announcementId: id,
            fileName: safeFileName(f.name),
            contentType: f.type,
            sizeBytes: f.bytes.length,
            sha256: createHash("sha256").update(f.bytes).digest("hex"),
            contentBase64: Buffer.from(f.bytes).toString("base64"),
            uploadedBy: ctx.userId,
            uploadedAt: now,
          }),
        );
      if (outcome !== "draft") statements.push(transition(q, id, outcome, ctx.userId, null, now));
      if (outcome === "published")
        statements.push(...fanOut(q, authed, { id, ...content, author: ctx.name }, students, now));
      statements.push(q.insert(s.auditEvent).values(audit));
      return statements as Statements;
    });
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }

  const message =
    outcome === "draft"
      ? "Draft saved."
      : outcome === "published"
        ? `Published to ${content.audienceLabel}.`
        : "Submitted for approval. You'll be notified when it is decided.";
  return { ok: true, message, auditId: audit.id };
}

async function noticeFor(authed: Authed, input: unknown) {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return null;
  return loadAnnouncement(getDb(), authed.ctx.tenantId, parsed.data.id);
}

export async function decideNotice(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      id: z.uuid(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(500).optional(),
    })
    .refine((d) => d.decision === "approved" || (d.note ?? "").length >= 3, {
      message: "Tell the author what to change.",
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision.");
  const d = parsed.data;
  const a = await loadAnnouncement(getDb(), authed.ctx.tenantId, d.id);
  if (!a || a.status === "draft") return fail("Unknown notice.");
  const action = d.decision === "approved" ? "announcement.approve" : "announcement.reject";
  if (a.authorId === authed.ctx.userId)
    return denied(authed, action, "announcement", "You can't decide your own notice.", a.id);
  if (!canApprove(authed.ctx, authed.tree, a))
    return denied(authed, action, "announcement", "You don't approve notices for this audience.", a.id);
  if (a.status !== "pending") return fail(`This notice is already ${a.status}.`);

  const now = institutionNow();
  const students = d.decision === "approved" ? await recipientStudents(authed) : [];
  const audit = await successAudit(authed, action, "announcement", a.id, {
    title: a.title,
    audience: a.audienceLabel,
  });
  const notify = notificationRows(
    authed.ctx.tenantId,
    [a.authorId],
    d.decision === "approved"
      ? {
          kind: "announcement.approved",
          title: `Published: ${a.title}`,
          body: `${authed.ctx.name} approved your notice to ${a.audienceLabel}.`,
          href: `/announcements/sent?id=${a.id}`,
        }
      : {
          kind: "announcement.rejected",
          title: `Returned: ${a.title}`,
          body: `${authed.ctx.name}: “${d.note}”`,
          href: `/announcements/sent?id=${a.id}`,
        },
    now,
  );
  try {
    await run(authed, (q) => {
      const statements: BatchItem<"pg">[] = [
        transition(
          q,
          a.id,
          d.decision === "approved" ? "published" : "rejected",
          authed.ctx.userId,
          d.note ?? null,
          now,
        ),
      ];
      if (d.decision === "approved") statements.push(...fanOut(q, authed, a, students, now));
      if (notify.length > 0) statements.push(q.insert(s.userNotification).values(notify));
      statements.push(q.insert(s.auditEvent).values(audit));
      return statements as Statements;
    });
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message:
      d.decision === "approved"
        ? `“${a.title}” approved and published.`
        : `“${a.title}” returned to ${a.author}.`,
    auditId: audit.id,
  };
}

/** Author takes a pending notice back to draft. */
export async function recallNotice(authed: Authed, input: unknown): Promise<ActionResult> {
  const a = await noticeFor(authed, input);
  if (!a || a.authorId !== authed.ctx.userId) return fail("Unknown notice.");
  if (a.status !== "pending") return fail("Only a notice awaiting approval can be recalled.");
  const now = institutionNow();
  const audit = await successAudit(authed, "announcement.recall", "announcement", a.id, { title: a.title });
  try {
    await run(authed, (q) => [
      transition(q, a.id, "draft", authed.ctx.userId, null, now),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return { ok: true, message: "Recalled to drafts.", auditId: audit.id };
}

export async function deleteDraft(authed: Authed, input: unknown): Promise<ActionResult> {
  const a = await noticeFor(authed, input);
  if (!a || a.authorId !== authed.ctx.userId) return fail("Unknown notice.");
  if (a.status !== "draft") return fail("Only drafts can be deleted.");
  const audit = await successAudit(authed, "announcement.delete", "announcement", a.id, { title: a.title });
  try {
    await run(authed, (q) => [
      q.delete(s.announcement).where(eq(s.announcement.id, a.id)),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return { ok: true, message: "Draft deleted.", auditId: audit.id };
}

export async function withdrawNotice(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ id: z.uuid(), reason: z.string().trim().min(5, "Say why the notice is withdrawn.").max(300) })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  const a = await loadAnnouncement(getDb(), authed.ctx.tenantId, parsed.data.id);
  if (!a) return fail("Unknown notice.");
  if (!canManageNotice(authed.ctx, authed.tree, a))
    return denied(
      authed,
      "announcement.withdraw",
      "announcement",
      "Only the author or an approver for this audience withdraws it.",
      a.id,
    );
  if (a.status !== "published") return fail("Only a published notice can be withdrawn.");
  const now = institutionNow();
  const audit = await successAudit(authed, "announcement.withdraw", "announcement", a.id, {
    title: a.title,
    reason: parsed.data.reason,
  });
  try {
    await run(authed, (q) => {
      const statements: BatchItem<"pg">[] = [
        transition(q, a.id, "withdrawn", authed.ctx.userId, parsed.data.reason, now),
        // Messages that have not left yet never will.
        q
          .update(s.notificationOutbox)
          .set({ status: "suppressed", lastError: "Notice withdrawn" })
          .where(
            and(
              inArray(s.notificationOutbox.sourceType, ["announcement", "reminder"]),
              eq(s.notificationOutbox.sourceId, a.id),
              inArray(s.notificationOutbox.status, ["queued", "held", "failed"]),
            ),
          ),
        q.insert(s.auditEvent).values(audit),
      ];
      return statements as Statements;
    });
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return { ok: true, message: `“${a.title}” withdrawn. Recipients no longer see it.`, auditId: audit.id };
}

export async function acknowledgeNotice(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Unknown notice.");
  const item = await getInboxItem(authed, parsed.data.id);
  if (!item) return fail("Unknown notice.");
  if (!item.requiresAck) return fail("This notice doesn't ask for acknowledgement.");
  const keys = await myKeysFor(authed, item.audience);
  if (keys.length === 0)
    return fail("This notice isn't addressed to you, so there's nothing to acknowledge.");
  if (item.acknowledged) return fail("Already acknowledged.");
  const now = institutionNow();
  const audit = await successAudit(authed, "announcement.acknowledge", "announcement", item.id, {
    title: item.title,
    as: keys,
  });
  await run(authed, (q) => [
    q
      .insert(s.announcementReceipt)
      .values(keys.map((key) => receiptValues(authed, item.id, key, now, { acknowledged: true })))
      .onConflictDoUpdate({
        target: [s.announcementReceipt.announcementId, s.announcementReceipt.recipientKey],
        set: {
          readAt: sql`coalesce(${s.announcementReceipt.readAt}, excluded.read_at)`,
          acknowledgedAt: sql`coalesce(${s.announcementReceipt.acknowledgedAt}, excluded.acknowledged_at)`,
        },
      }),
    q.insert(s.auditEvent).values(audit),
  ]);
  return { ok: true, message: "Acknowledged.", auditId: audit.id };
}

/** Bookmarks are the viewer's own reading list: not audited. */
export async function toggleSaved(
  authed: Authed,
  input: unknown,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Unknown notice.");
  const item = await getInboxItem(authed, parsed.data.id);
  if (!item) return fail("Unknown notice.");
  const where = and(
    eq(s.announcementBookmark.announcementId, item.id),
    eq(s.announcementBookmark.userId, authed.ctx.userId),
  );
  await run(authed, (q) => [
    item.saved
      ? q.delete(s.announcementBookmark).where(where)
      : q
          .insert(s.announcementBookmark)
          .values({
            tenantId: authed.ctx.tenantId,
            announcementId: item.id,
            userId: authed.ctx.userId,
            createdAt: institutionNow(),
          })
          .onConflictDoNothing(),
  ]);
  return { ok: true, message: item.saved ? "Removed from saved." : "Saved." };
}

/** Email the students and households who have not acknowledged yet (once a day at most). */
export async function remindPending(authed: Authed, input: unknown): Promise<ActionResult> {
  const a = await noticeFor(authed, input);
  if (!a) return fail("Unknown notice.");
  if (!canManageNotice(authed.ctx, authed.tree, a))
    return denied(
      authed,
      "announcement.remind",
      "announcement",
      "Only the author or an approver for this audience sends reminders.",
      a.id,
    );
  if (a.status !== "published" || !a.requiresAck)
    return fail("Reminders are for published notices that ask for acknowledgement.");
  const now = institutionNow();
  if (a.expiresAt && new Date(a.expiresAt) <= now) return fail("This notice has expired.");
  if (!canRemind(a.remindedAt, now)) return fail("A reminder went out in the last 24 hours.");

  const [{ pending }, students] = await Promise.all([
    loadEngagement(getDb(), authed.ctx.tenantId, a.id, 10_000),
    recipientStudents(authed),
  ]);
  const byId = new Map(students.map((st) => [st.id, st]));
  const { subject, body } = noticeEmail(a, true);
  const emails: OutgoingEmail[] = pending.flatMap((p): OutgoingEmail[] => {
    const st = byId.get(p.studentId);
    if (!st) return [];
    return p.kind === "guardian"
      ? [
          {
            recipientKind: "guardian" as const,
            studentId: st.id,
            toName: st.guardianName ?? "Guardian",
            toAddress: st.guardianEmail,
            subject,
            body,
          },
        ]
      : [
          {
            recipientKind: "student" as const,
            studentId: st.id,
            toName: st.name,
            toAddress: st.email,
            subject,
            body,
          },
        ];
  });
  if (emails.length === 0) return fail("Everyone addressed has acknowledged.");
  const rows = outboxRows(
    authed.ctx.tenantId,
    { type: "reminder", id: a.id },
    emails,
    now,
    a.severity === "critical",
  );
  const audit = await successAudit(authed, "announcement.remind", "announcement", a.id, {
    title: a.title,
    recipients: emails.length,
  });
  await run(authed, (q) => {
    const statements: BatchItem<"pg">[] = [
      q.update(s.announcement).set({ remindedAt: now }).where(eq(s.announcement.id, a.id)),
    ];
    for (let i = 0; i < rows.length; i += 500)
      statements.push(q.insert(s.notificationOutbox).values(rows.slice(i, i + 500)));
    statements.push(q.insert(s.auditEvent).values(audit));
    return statements as Statements;
  });
  const held = rows[0]?.status === "held";
  return {
    ok: true,
    message: `Reminder queued for ${emails.length} recipients${held ? " — held until 07:00 (quiet hours)" : ""}.`,
    auditId: audit.id,
  };
}
