import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { canMessageGuardiansOf } from "@/domains/announcements/guards";
import { recipientStudents } from "@/domains/announcements/repository";
import { notificationRows, outboxRows } from "@/domains/notifications/outbox";
import { deliverAt } from "@/domains/notifications/quiet-hours";
import { studentRef, visibleStudents } from "@/domains/students/repository";
import { denied, fail, successAudit, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import { loadMessages } from "./load";
import { render, TEMPLATE_KEYS } from "./templates";

/*
 * Guardian messages: one per student, rendered with that student's figures, delivered in the app to linked guardian
 * accounts and by email to the primary guardian (quiet hours apply). Guardians acknowledge, and may reply once.
 */

type Statements = [BatchItem<"pg">, ...BatchItem<"pg">[]];

export const MAX_RECIPIENTS = 120;

const sendSchema = z.object({
  studentIds: z
    .array(z.uuid())
    .min(1, "Choose at least one student.")
    .max(MAX_RECIPIENTS, `Send to at most ${MAX_RECIPIENTS} students at a time.`),
  template: z.enum(TEMPLATE_KEYS),
  subject: z.string().trim().min(3, "Add a subject.").max(140),
  body: z.string().trim().min(10, "Write the message.").max(4000),
});

/** Linked guardian accounts per student number (identity tables sit outside RLS; filtered by tenant). */
async function guardianUsers(tenantId: string, studentNumbers: readonly string[]) {
  if (studentNumbers.length === 0) return new Map<string, string[]>();
  const rows = await getDb()
    .select({ userId: s.studentLink.userId, studentNumber: s.studentLink.studentNumber })
    .from(s.studentLink)
    .where(
      and(
        eq(s.studentLink.tenantId, tenantId),
        eq(s.studentLink.relation, "guardian"),
        inArray(s.studentLink.studentNumber, [...studentNumbers]),
      ),
    );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.studentNumber, [...(out.get(r.studentNumber) ?? []), r.userId]);
  return out;
}

export async function sendGuardianMessages(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the message and try again.");
  const d = parsed.data;
  const { ctx, tree } = authed;
  const ids = [...new Set(d.studentIds)];

  const [visible, recipients] = await Promise.all([visibleStudents(authed), recipientStudents(authed)]);
  const byId = new Map(visible.map((v) => [v.student.id, v.student]));
  const chosen = ids.map((id) => byId.get(id));
  if (chosen.some((st) => !st)) return fail("Some of those students are not in your scope.");
  const students = chosen as NonNullable<(typeof chosen)[number]>[];
  const outside = students.find((st) => !canMessageGuardiansOf(ctx, tree, studentRef(st, ctx.tenantId)));
  if (outside)
    return denied(
      authed,
      "guardian_message.send",
      "student",
      `You don't message guardians of ${outside.sectionLabel}.`,
      outside.studentNumber,
    );

  const guardians = new Map(recipients.map((r) => [r.id, r]));
  const linkedUsers = await guardianUsers(
    ctx.tenantId,
    students.map((st) => st.studentNumber),
  );
  const now = institutionNow();
  const batchId = crypto.randomUUID();
  const senderRole = ctx.active?.roleName ?? "Staff";
  const institution = tree.root.name;

  const messages = students.map((st) => {
    const g = guardians.get(st.id);
    const fields = {
      student: st.name,
      roll: st.studentNumber,
      section: st.sectionLabel,
      attendance: st.attendancePct.toFixed(1),
      threshold: String(st.attendanceThreshold),
      guardian: g?.guardianName ?? "Parent/Guardian",
      sender: `${ctx.name}, ${senderRole}`,
      institution,
    };
    return {
      id: crypto.randomUUID(),
      student: st,
      guardianName: g?.guardianName ?? "Parent/Guardian",
      guardianEmail: g?.guardianEmail ?? null,
      subject: render(d.subject, fields),
      body: render(d.body, fields),
    };
  });
  const suppressed = messages.filter((m) => !m.guardianEmail).length;
  const audit = await successAudit(authed, "guardian_message.send", "guardian_message", batchId, {
    template: d.template,
    students: students.map((st) => st.studentNumber),
    emailSuppressed: suppressed,
  });

  await withTenant(getDb(), ctx.tenantId, (q) => {
    const statements: BatchItem<"pg">[] = [
      q.insert(s.guardianMessage).values(
        messages.map((m) => ({
          id: m.id,
          tenantId: ctx.tenantId,
          studentId: m.student.id,
          batchId,
          template: d.template,
          subject: m.subject,
          body: m.body,
          senderId: ctx.userId,
          senderName: ctx.name,
          senderRole,
          sentAt: now,
        })),
      ),
    ];
    const emails = messages.flatMap((m) =>
      outboxRows(
        ctx.tenantId,
        { type: "guardian_message", id: m.id },
        [
          {
            recipientKind: "guardian",
            studentId: m.student.id,
            toName: m.guardianName,
            toAddress: m.guardianEmail,
            subject: m.subject,
            body: m.body,
          },
        ],
        now,
        false,
      ),
    );
    statements.push(q.insert(s.notificationOutbox).values(emails));
    const notify = messages.flatMap((m) =>
      notificationRows(
        ctx.tenantId,
        linkedUsers.get(m.student.studentNumber) ?? [],
        {
          kind: "guardian_message.received",
          title: m.subject,
          body: `From ${ctx.name}, ${senderRole}`,
          href: "/my/messages",
        },
        now,
      ),
    );
    if (notify.length > 0) statements.push(q.insert(s.userNotification).values(notify));
    statements.push(q.insert(s.auditEvent).values(audit));
    return statements as Statements;
  });

  const held = messages.length > suppressed && deliverAt(now, false) > now;
  return {
    ok: true,
    message: [
      `Sent to the guardians of ${messages.length} ${messages.length === 1 ? "student" : "students"}.`,
      held ? "Emails are held until 07:00 (quiet hours)." : "",
      suppressed > 0 ? `${suppressed} without an email address will see it in the app only.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    auditId: audit.id,
  };
}

const ackSchema = z.object({
  id: z.uuid(),
  reply: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(500).optional(),
  ),
});

/** A linked guardian acknowledges a message, optionally replying; the sender is notified. */
export async function acknowledgeMessage(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = ackSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid reply.");
  const { ctx } = authed;
  const [m] = await loadMessages(getDb(), ctx.tenantId, eq(s.guardianMessage.id, parsed.data.id), 1);
  const linked = m && ctx.links.some((l) => l.relation === "guardian" && l.studentNumber === m.studentNumber);
  if (!m || !linked) return fail("Unknown message.");
  if (m.acknowledgedAt) return fail("You've already acknowledged this message.");
  const now = institutionNow();
  const reply = parsed.data.reply ?? null;
  const audit = await successAudit(authed, "guardian_message.acknowledge", "guardian_message", m.id, {
    student: m.studentNumber,
    replied: reply !== null,
  });
  const notify = notificationRows(
    ctx.tenantId,
    [m.senderId],
    {
      kind: reply ? "guardian_message.reply" : "guardian_message.acknowledged",
      title: reply ? `Reply from ${ctx.name} (${m.studentName})` : `${ctx.name} acknowledged your message`,
      body: reply ? `“${reply}”` : m.subject,
      href: "/parent-communication#sent",
    },
    now,
  );
  await withTenant(getDb(), ctx.tenantId, (q) => [
    q
      .update(s.guardianMessage)
      .set({
        readAt: m.readAt ? new Date(m.readAt) : now,
        acknowledgedAt: now,
        acknowledgedBy: ctx.userId,
        reply,
      })
      // A second acknowledgement in a race changes nothing.
      .where(and(eq(s.guardianMessage.id, m.id), isNull(s.guardianMessage.acknowledgedAt))),
    q.insert(s.userNotification).values(notify),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: reply ? "Acknowledged — your reply was sent." : "Acknowledged.",
    auditId: audit.id,
  };
}
