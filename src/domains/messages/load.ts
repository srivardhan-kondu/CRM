import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { TemplateKey } from "./templates";

/* Guardian message loaders: Next-agnostic and under RLS. */

type Db = NeonHttpDatabase<typeof s>;

export interface MessageRow {
  id: string;
  batchId: string;
  studentId: string;
  studentNumber: string;
  studentName: string;
  sectionCode: string;
  template: TemplateKey;
  subject: string;
  body: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  sentAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  reply: string | null;
  email: "queued" | "held" | "sent" | "failed" | "suppressed" | null;
}

export async function loadMessages(db: Db, tenantId: string, where: SQL, limit = 200): Promise<MessageRow[]> {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.guardianMessage.id,
        batchId: s.guardianMessage.batchId,
        studentId: s.student.id,
        studentNumber: s.student.studentNumber,
        studentName: s.student.name,
        sectionCode: s.orgUnit.code,
        template: s.guardianMessage.template,
        subject: s.guardianMessage.subject,
        body: s.guardianMessage.body,
        senderId: s.guardianMessage.senderId,
        senderName: s.guardianMessage.senderName,
        senderRole: s.guardianMessage.senderRole,
        sentAt: s.guardianMessage.sentAt,
        readAt: s.guardianMessage.readAt,
        acknowledgedAt: s.guardianMessage.acknowledgedAt,
        reply: s.guardianMessage.reply,
        email: s.notificationOutbox.status,
      })
      .from(s.guardianMessage)
      .innerJoin(s.student, eq(s.student.id, s.guardianMessage.studentId))
      .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.student.sectionId))
      .leftJoin(
        s.notificationOutbox,
        and(
          eq(s.notificationOutbox.sourceType, "guardian_message"),
          eq(s.notificationOutbox.sourceId, s.guardianMessage.id),
        ),
      )
      .where(where)
      .orderBy(desc(s.guardianMessage.sentAt), desc(s.guardianMessage.id))
      .limit(limit),
  ]);
  return rows.map((r) => ({
    ...r,
    sentAt: r.sentAt.toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
  }));
}

export const forStudents = (ids: readonly string[]) => inArray(s.guardianMessage.studentId, [...ids]);

/** When each student's guardians were last told about attendance (shortage or exam eligibility). */
export async function loadLastAttendanceContact(db: Db, tenantId: string): Promise<Map<string, string>> {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({ studentId: s.guardianMessage.studentId, sentAt: s.guardianMessage.sentAt })
      .from(s.guardianMessage)
      .where(inArray(s.guardianMessage.template, ["attendance_shortage", "exam_eligibility"])),
  ]);
  const out = new Map<string, string>();
  for (const r of rows) {
    const at = r.sentAt.toISOString();
    if ((out.get(r.studentId) ?? "") < at) out.set(r.studentId, at);
  }
  return out;
}
