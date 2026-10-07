import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { canMessageGuardiansOf } from "@/domains/announcements/guards";
import { recipientStudents } from "@/domains/announcements/repository";
import { linkedStudents, studentRef, visibleStudents } from "@/domains/students/repository";
import type { Student } from "@/domains/students/types";
import type { Authed } from "@/lib/authz/context";
import { holdsAnywhere } from "@/lib/authz/engine";
import { institutionNow } from "@/lib/clock";
import { forStudents, loadLastAttendanceContact, loadMessages, type MessageRow } from "./load";
import { suggestFollowUp, type FollowUp } from "./suggest";

/* Guardian message reads: what staff may send and have sent, and what guardians have received. */

const db = () => getDb();

export const canUseParentCommunication = (authed: Authed) => holdsAnywhere(authed.ctx, "guardian:message");

export interface Contactable {
  id: string;
  name: string;
  studentNumber: string;
  sectionId: string;
  sectionLabel: string;
  attendancePct: number;
  attendanceThreshold: number;
  guardianName: string | null;
  guardianEmail: boolean;
  lastContactedAt: string | null;
  followUp: FollowUp | null;
}

/** Students whose guardians the viewer may message, with the follow-up their attendance suggests. */
export async function contactableStudents(authed: Authed): Promise<Contactable[] | null> {
  if (!canUseParentCommunication(authed)) return null;
  const { ctx, tree } = authed;
  const [visible, recipients, lastContact] = await Promise.all([
    visibleStudents(authed),
    recipientStudents(authed),
    loadLastAttendanceContact(db(), ctx.tenantId),
  ]);
  const guardians = new Map(recipients.map((r) => [r.id, r]));
  const now = institutionNow();
  return visible
    .filter((v) => canMessageGuardiansOf(ctx, tree, studentRef(v.student, ctx.tenantId)))
    .map(({ student: st }) => {
      const g = guardians.get(st.id);
      const last = lastContact.get(st.id) ?? null;
      return {
        id: st.id,
        name: st.name,
        studentNumber: st.studentNumber,
        sectionId: st.sectionId,
        sectionLabel: st.sectionLabel,
        attendancePct: st.attendancePct,
        attendanceThreshold: st.attendanceThreshold,
        guardianName: g?.guardianName ?? null,
        guardianEmail: !!g?.guardianEmail,
        lastContactedAt: last,
        followUp: suggestFollowUp(st, last, now),
      };
    })
    .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));
}

/** Messages to guardians of students the viewer may message (any sender), newest first. */
export async function sentLog(authed: Authed, limit = 60): Promise<MessageRow[]> {
  const students = await contactableStudents(authed);
  if (!students || students.length === 0) return [];
  return loadMessages(db(), authed.ctx.tenantId, forStudents(students.map((st) => st.id)), limit);
}

/** Messages to the guardians of the user's linked children. */
export async function guardianInbox(authed: Authed): Promise<MessageRow[]> {
  const children = await linkedStudents(authed, "guardian");
  if (children.length === 0) return [];
  return loadMessages(db(), authed.ctx.tenantId, forStudents(children.map((c) => c.student.id)));
}

export async function unreadGuardianMessages(authed: Authed): Promise<number> {
  if (!authed.ctx.links.some((l) => l.relation === "guardian")) return 0;
  return (await guardianInbox(authed)).filter((m) => !m.readAt).length;
}

/** A guardian opened their messages: everything unread becomes read. */
export async function markGuardianMessagesRead(authed: Authed, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .update(s.guardianMessage)
      .set({ readAt: institutionNow() })
      .where(and(inArray(s.guardianMessage.id, [...ids]), isNull(s.guardianMessage.readAt))),
  ]);
}

/** Guardian communication on Student 360, for those who may read guardian details. */
export async function messagesForStudent(authed: Authed, student: Student, guardianAccess: boolean) {
  if (!guardianAccess) return null;
  return loadMessages(db(), authed.ctx.tenantId, eq(s.guardianMessage.studentId, student.id), 6);
}
