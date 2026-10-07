import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { denied, fail, successAudit, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { authorize } from "@/lib/authz/engine";
import { DEMO_NOW } from "@/lib/demo/fixtures";

/*
 * Student record mutations (`student:manage`). The record is authoritative, so every change is audited with its
 * before/after values, and section moves keep the placement history consistent: the open history row is closed
 * and a new one opened in the same transaction as the move.
 */

const canManageStudentIn = (authed: Authed, sectionId: string) =>
  authorize(authed.ctx, authed.tree, "student:manage", {
    kind: "org_unit",
    tenantId: authed.ctx.tenantId,
    orgUnitId: sectionId,
  }).allowed;

async function current(authed: Authed, studentId: string) {
  const [rows] = await withTenant(getDb(), authed.ctx.tenantId, (q) => [
    q
      .select({
        id: s.student.id,
        studentNumber: s.student.studentNumber,
        name: s.student.name,
        email: s.student.email,
        phone: s.student.phone,
        status: s.student.status,
        hosteller: s.student.hosteller,
        sectionId: s.student.sectionId,
        batchId: s.student.batchId,
      })
      .from(s.student)
      .where(eq(s.student.id, studentId)),
  ]);
  return rows[0] ?? null;
}

export const profileSchema = z.object({
  studentId: z.uuid(),
  email: z.email("Enter a valid email address.").transform((v) => v.trim().toLowerCase()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{7,16}$/, "Enter a valid phone number."),
  status: z.enum(["active", "on_leave", "detained", "graduated", "withdrawn"]),
  hosteller: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export async function updateStudentProfile(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { studentId, ...next } = parsed.data;
  const before = await current(authed, studentId);
  if (!before) return fail("Unknown student.");
  if (!canManageStudentIn(authed, before.sectionId))
    return denied(
      authed,
      "student.update",
      "student",
      "Editing this student's record is outside your scope.",
      before.studentNumber,
    );

  const changes = Object.fromEntries(
    (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => before[k] !== next[k])
      .map((k) => [k, { from: before[k], to: next[k] }]),
  );
  if (Object.keys(changes).length === 0) return fail("Nothing changed.");
  const audit = await successAudit(authed, "student.update", "student", before.studentNumber, { changes });
  await withTenant(getDb(), authed.ctx.tenantId, (q) => [
    q
      .update(s.student)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(s.student.id, studentId)),
    q.insert(s.auditEvent).values(audit),
  ]);
  return { ok: true, message: `${before.name}'s record updated.`, auditId: audit.id };
}

export const transferSchema = z.object({
  studentId: z.uuid(),
  toSectionId: z.uuid("Choose the new section."),
  reason: z.string().trim().min(5, "Give a reason for the move (it stays on the record).").max(300),
});

/** Moves a student to another section of the same batch. Moving between batches is a re-admission, not a transfer. */
export async function transferStudent(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  const req = parsed.data;
  const before = await current(authed, req.studentId);
  if (!before) return fail("Unknown student.");
  if (before.sectionId === req.toSectionId) return fail("The student is already in that section.");
  if (!canManageStudentIn(authed, before.sectionId) || !canManageStudentIn(authed, req.toSectionId))
    return denied(
      authed,
      "student.transfer",
      "student",
      "You need student:manage over both sections to move a student.",
      before.studentNumber,
    );

  const [target] = await withTenant(getDb(), authed.ctx.tenantId, (q) => [
    q
      .select({ batchId: s.section.batchId, label: s.section.label })
      .from(s.section)
      .where(eq(s.section.orgUnitId, req.toSectionId)),
  ]);
  if (!target[0]) return fail("Unknown section.");
  if (target[0].batchId !== before.batchId)
    return fail("Students can only move between sections of their own batch.");

  const today = DEMO_NOW.toISOString().slice(0, 10);
  const from = authed.tree.byId.get(before.sectionId);
  const audit = await successAudit(authed, "student.transfer", "student", before.studentNumber, {
    from: from?.code ?? before.sectionId,
    to: authed.tree.byId.get(req.toSectionId)?.code ?? req.toSectionId,
    reason: req.reason,
  });
  await withTenant(getDb(), authed.ctx.tenantId, (q) => [
    q
      .update(s.studentSectionHistory)
      .set({ endedOn: today })
      .where(and(eq(s.studentSectionHistory.studentId, before.id), isNull(s.studentSectionHistory.endedOn))),
    q.insert(s.studentSectionHistory).values({
      tenantId: authed.ctx.tenantId,
      studentId: before.id,
      sectionId: req.toSectionId,
      startedOn: today,
      reason: req.reason,
      recordedBy: authed.ctx.userId,
    }),
    q
      .update(s.student)
      .set({ sectionId: req.toSectionId, updatedAt: new Date() })
      .where(eq(s.student.id, before.id)),
    q.insert(s.auditEvent).values(audit),
  ]);
  return { ok: true, message: `${before.name} moved to section ${target[0].label}.`, auditId: audit.id };
}

/** Sections a student may be moved to: same batch, and within the viewer's student:manage scope. */
export async function transferTargets(authed: Authed, studentId: string) {
  const before = await current(authed, studentId);
  if (!before || !canManageStudentIn(authed, before.sectionId)) return null;
  const [rows] = await withTenant(getDb(), authed.ctx.tenantId, (q) => [
    q
      .select({ id: s.section.orgUnitId, label: s.section.label })
      .from(s.section)
      .where(eq(s.section.batchId, before.batchId)),
  ]);
  return rows
    .filter((r) => r.id !== before.sectionId && canManageStudentIn(authed, r.id))
    .sort((a, b) => a.label.localeCompare(b.label));
}
