import "server-only";

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import type { ProposedSession } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { notify } from "@/domains/notifications/notify";
import { loadStudentById } from "@/domains/students/load";
import { studentRef } from "@/domains/students/repository";
import { denied, fail, successAudit, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { institutionNow, institutionToday } from "@/lib/clock";
import { addDays, isClockTime, isIsoDate } from "./calendar";
import {
  canApproveAttendanceIn,
  canDeclareHoliday,
  canDecideLeaveIn,
  canMarkCourse,
  canRequestLeaveFor,
  canSetInstitutionPolicy,
  canSetProgrammeThreshold,
} from "./guards";
import { loadLeaves, loadRequests, loadRoll, loadSessionMarks, loadSessions, loadSlots } from "./load";
import { attendanceContext } from "./repository";
import {
  LEAVE_AHEAD_DAYS,
  LEAVE_BACKDATE_DAYS,
  LEAVE_MAX_DAYS,
  markChanges,
  markingWindow,
  type Mark,
} from "./rules";
import { occurrences } from "./schedule";

/*
 * Attendance mutations. Each authorizes with the attendance guards, validates, then writes the change and its audit
 * event in one transaction under RLS. Session saves and decisions go through database functions (migration 0005)
 * that re-check state under a row lock, so a request decided twice fails instead of applying twice. Refusals are
 * audited as denials.
 */

const db = () => getDb();

/** Postgres error code from a driver error, possibly wrapped by Drizzle. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

const isoDate = z.string().refine(isIsoDate, "Use a date like 2026-10-06.");
const clock = z.string().refine(isClockTime, "Use a time like 09:00.");
const sessionKeySchema = z.object({ offeringId: z.uuid(), date: isoDate, startsAt: clock });
const proposalSchema = sessionKeySchema.extend({
  status: z.enum(["held", "cancelled"]),
  cancelReason: z.string().trim().max(200).optional(),
  marks: z.record(z.uuid(), z.enum(["present", "absent"])).default({}),
});

/** Resolve and validate a class meeting: offering, timetable slot (or an existing record), and the day's roll. */
async function classContext(authed: Authed, key: z.infer<typeof sessionKeySchema>) {
  const c = await attendanceContext(authed);
  const offering = c?.offerings.get(key.offeringId);
  if (!c || !offering) return null;
  const [slots, sessions, roll] = await Promise.all([
    loadSlots(db(), authed.ctx.tenantId, c.term.id),
    loadSessions(db(), authed.ctx.tenantId, { offeringIds: [offering.id], from: key.date, to: key.date }),
    loadRoll(db(), authed.ctx.tenantId, offering.sectionId, key.date),
  ]);
  const occurrence = occurrences(
    slots.filter((sl) => sl.offeringId === offering.id),
    c.holidayDates,
    key.date,
    key.date,
  ).find((o) => o.startsAt === key.startsAt);
  const recorded = sessions.find((x) => x.startsAt === key.startsAt) ?? null;
  if (!occurrence && !recorded) return null;
  return { c, offering, occurrence, recorded, roll, endsAt: occurrence?.endsAt ?? recorded!.endsAt };
}

/** A held session must mark every student on the day's roll and nobody else. */
function checkRoll(
  proposal: z.infer<typeof proposalSchema>,
  roll: { id: string }[],
): { ok: true; proposed: ProposedSession } | { ok: false; error: string } {
  if (proposal.status === "cancelled") {
    const reason = proposal.cancelReason ?? "";
    if (reason.length < 3) return { ok: false, error: "Say why the class was not held." };
    return { ok: true, proposed: { status: "cancelled", cancelReason: reason, marks: {} } };
  }
  const ids = new Set(roll.map((r) => r.id));
  const marked = Object.keys(proposal.marks);
  const extra = marked.filter((id) => !ids.has(id));
  if (extra.length)
    return { ok: false, error: "Some marks are for students who are not on this class's roll." };
  const missing = roll.length - marked.length;
  if (missing > 0)
    return {
      ok: false,
      error: `Mark every student: ${missing} still ${missing === 1 ? "has" : "have"} no mark.`,
    };
  if (roll.length === 0) return { ok: false, error: "This class has no students on its roll that day." };
  return { ok: true, proposed: { status: "held", marks: proposal.marks } };
}

const counts = (p: ProposedSession) => {
  const values = Object.values(p.marks);
  return {
    present: values.filter((m) => m === "present").length,
    absent: values.filter((m) => m === "absent").length,
  };
};

/* ---------- Marking (same day) ---------- */

export async function markSession(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid attendance.");
  const p = parsed.data;
  const cls = await classContext(authed, p);
  if (!cls) return fail("There is no such class on that day.");
  const { c, offering, recorded, roll } = cls;
  const label = `${offering.courseCode} · ${offering.sectionLabel}`;
  if (!canMarkCourse(authed.ctx, authed.tree, offering.sectionId, offering.courseCode))
    return denied(
      authed,
      "attendance.mark",
      "offering",
      `You don't take attendance for ${label}.`,
      offering.id,
    );
  const window = markingWindow(p, c.now);
  if (window === "upcoming") return fail(`${label} at ${p.startsAt} hasn't started yet.`);
  if (window === "closed")
    return fail(
      "That class was on an earlier day. Changes now need a correction request, approved by your HOD.",
    );
  const checked = checkRoll(p, roll);
  if (!checked.ok) return fail(checked.error);

  const n = counts(checked.proposed);
  const audit = await successAudit(authed, "attendance.mark", "offering", offering.id, {
    course: offering.courseCode,
    section: offering.sectionLabel,
    date: p.date,
    startsAt: p.startsAt,
    status: checked.proposed.status,
    ...(checked.proposed.status === "held" ? n : { reason: checked.proposed.cancelReason }),
    previous: recorded
      ? { status: recorded.status, present: recorded.present, absent: recorded.absent }
      : null,
  });
  const at = institutionNow();
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.execute(
      sql`select attendance_save(${offering.id}, ${p.date}::date, ${p.startsAt}, ${cls.endsAt}, ${JSON.stringify(checked.proposed)}::jsonb, ${authed.ctx.userId}::uuid, ${at.toISOString()}::timestamptz)`,
    ),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message:
      checked.proposed.status === "held"
        ? `${label}: ${n.present} present, ${n.absent} absent.${recorded ? " Updated." : " Saved."}`
        : `${label} recorded as not held.`,
    auditId: audit.id,
  };
}

/* ---------- Requests (after the day) ---------- */

const requestSchema = proposalSchema.extend({
  reason: z.string().trim().min(10, "Explain the change in a sentence (at least 10 characters).").max(500),
});

export async function requestChange(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  const p = parsed.data;
  const cls = await classContext(authed, p);
  if (!cls) return fail("There is no such class on that day.");
  const { c, offering, recorded, roll } = cls;
  const label = `${offering.courseCode} · ${offering.sectionLabel}`;
  if (!canMarkCourse(authed.ctx, authed.tree, offering.sectionId, offering.courseCode))
    return denied(
      authed,
      "attendance.request",
      "offering",
      `You don't take attendance for ${label}.`,
      offering.id,
    );
  if (markingWindow(p, c.now) !== "closed")
    return fail("This class is today — mark or change it directly; no request is needed.");
  const checked = checkRoll(p, roll);
  if (!checked.ok) return fail(checked.error);

  const kind = recorded ? "correction" : "late_submission";
  if (recorded) {
    const current = await loadSessionMarks(db(), authed.ctx.tenantId, p);
    const changes = markChanges(current, checked.proposed.marks);
    const statusChanged = recorded.status !== checked.proposed.status;
    if (!statusChanged && changes.length === 0)
      return fail("Nothing to change — the marks are the same as recorded.");
  }

  const id = crypto.randomUUID();
  const audit = await successAudit(authed, "attendance.request", "attendance_request", id, {
    kind,
    course: offering.courseCode,
    section: offering.sectionLabel,
    date: p.date,
    startsAt: p.startsAt,
    reason: p.reason,
  });
  try {
    await withTenant(db(), authed.ctx.tenantId, (q) => [
      q.insert(s.attendanceRequest).values({
        id,
        tenantId: authed.ctx.tenantId,
        offeringId: offering.id,
        date: p.date,
        startsAt: p.startsAt,
        endsAt: cls.endsAt,
        kind,
        proposed: checked.proposed,
        reason: p.reason,
        requestedBy: authed.ctx.userId,
        requestedAt: institutionNow(),
      }),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    if (pgCode(err) === "23505") return fail("A request for this class is already waiting for approval.");
    throw err;
  }
  return {
    ok: true,
    message: `${kind === "correction" ? "Correction" : "Late submission"} for ${label} on ${p.date} sent for approval.`,
    auditId: audit.id,
  };
}

const decisionSchema = z
  .object({
    id: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.decision === "approved" || (d.note ?? "").length >= 3, {
    message: "Give a reason when rejecting, so the requester knows what to fix.",
  });

function decisionError(err: unknown): ActionResult | null {
  const code = pgCode(err);
  if (code === "55000") return fail("Someone has already decided this.");
  if (code === "23514")
    return fail("That change no longer fits the class roll; ask the requester to resubmit.");
  if (code === "42501") return fail("You can't do that.");
  return null;
}

export async function decideRequest(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision.");
  const d = parsed.data;
  const [r] = await loadRequests(db(), authed.ctx.tenantId, { ids: [d.id] });
  if (!r) return fail("That request no longer exists.");
  if (r.status !== "pending") return fail(`This request was already ${r.status}.`);
  const action = `attendance.request.${d.decision === "approved" ? "approve" : "reject"}`;
  if (r.requestedById === authed.ctx.userId)
    return denied(authed, action, "attendance_request", "You can't decide your own request.", r.id);
  if (!canApproveAttendanceIn(authed.ctx, authed.tree, r.sectionId))
    return denied(
      authed,
      action,
      "attendance_request",
      `You can't approve attendance for ${r.sectionLabel}.`,
      r.id,
    );

  const audit = await successAudit(authed, action, "attendance_request", r.id, {
    kind: r.kind,
    course: r.courseCode,
    section: r.sectionLabel,
    date: r.date,
    startsAt: r.startsAt,
    requestedBy: r.requestedById,
    note: d.note ?? null,
  });
  try {
    await withTenant(db(), authed.ctx.tenantId, (q) => [
      q.execute(
        sql`select attendance_request_decide(${r.id}::uuid, ${d.decision}::request_status, ${authed.ctx.userId}::uuid, ${d.note ?? null}, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
      ...notify(q, authed, r.requestedById, {
        kind: `attendance_request.${d.decision}`,
        title: `${d.decision === "approved" ? "Approved" : "Rejected"}: ${r.courseCode} · ${r.sectionLabel} on ${r.date}`,
        body: d.note ? `${authed.ctx.name}: “${d.note}”` : `Decided by ${authed.ctx.name}.`,
        href: "/approvals",
      }),
    ]);
  } catch (err) {
    const mapped = decisionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message:
      d.decision === "approved"
        ? `Approved: ${r.courseCode} · ${r.sectionLabel} on ${r.date} is updated.`
        : `Rejected and returned to ${r.requestedBy}.`,
    auditId: audit.id,
  };
}

export async function withdrawRequest(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const [r] = await loadRequests(db(), authed.ctx.tenantId, { ids: [parsed.data.id] });
  if (!r) return fail("That request no longer exists.");
  if (r.requestedById !== authed.ctx.userId)
    return denied(
      authed,
      "attendance.request.withdraw",
      "attendance_request",
      "Only the requester can withdraw it.",
      r.id,
    );
  if (r.status !== "pending") return fail(`This request was already ${r.status}.`);
  const audit = await successAudit(authed, "attendance.request.withdraw", "attendance_request", r.id, {
    course: r.courseCode,
    section: r.sectionLabel,
    date: r.date,
  });
  try {
    await withTenant(db(), authed.ctx.tenantId, (q) => [
      q.execute(
        sql`select attendance_request_decide(${r.id}::uuid, 'withdrawn'::request_status, ${authed.ctx.userId}::uuid, null, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    const mapped = decisionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return { ok: true, message: "Request withdrawn.", auditId: audit.id };
}

/* ---------- Student leave ---------- */

const leaveSchema = z
  .object({
    studentId: z.uuid(),
    kind: z.enum(["od", "medical"]),
    fromDate: isoDate,
    toDate: isoDate,
    reason: z.string().trim().min(5, "Give a short reason.").max(500),
  })
  .refine((l) => l.toDate >= l.fromDate, { message: "The leave can't end before it starts." });

export async function applyLeave(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = leaveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid leave.");
  const l = parsed.data;
  const bundle = await loadStudentById(db(), authed.ctx.tenantId, l.studentId);
  const student = bundle.students[0];
  if (!student) return fail("Unknown student.");
  if (!canRequestLeaveFor(authed.ctx, authed.tree, studentRef(student, authed.ctx.tenantId)))
    return denied(
      authed,
      "leave.request",
      "student",
      "You can't apply for leave for this student.",
      student.studentNumber,
    );

  const today = institutionToday().date;
  if (l.fromDate < addDays(today, -LEAVE_BACKDATE_DAYS))
    return fail(`Leave can be applied for up to ${LEAVE_BACKDATE_DAYS} days after it started.`);
  if (l.toDate > addDays(today, LEAVE_AHEAD_DAYS))
    return fail(`Leave can be applied for at most ${LEAVE_AHEAD_DAYS} days ahead.`);
  if (addDays(l.fromDate, LEAVE_MAX_DAYS - 1) < l.toDate)
    return fail(`One application covers at most ${LEAVE_MAX_DAYS} days.`);
  const existing = await loadLeaves(db(), authed.ctx.tenantId, { studentIds: [student.id] });
  const clash = existing.find(
    (e) =>
      (e.status === "pending" || e.status === "approved") && e.fromDate <= l.toDate && e.toDate >= l.fromDate,
  );
  if (clash)
    return fail(`This overlaps a ${clash.status} application (${clash.fromDate} to ${clash.toDate}).`);

  const id = crypto.randomUUID();
  const audit = await successAudit(authed, "leave.request", "student_leave", id, {
    student: student.studentNumber,
    kind: l.kind,
    fromDate: l.fromDate,
    toDate: l.toDate,
  });
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q.insert(s.studentLeave).values({
      id,
      tenantId: authed.ctx.tenantId,
      studentId: student.id,
      kind: l.kind,
      fromDate: l.fromDate,
      toDate: l.toDate,
      reason: l.reason,
      requestedBy: authed.ctx.userId,
      requestedAt: institutionNow(),
    }),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message: `${l.kind === "od" ? "On-duty" : "Medical"} leave for ${student.name} sent to the class incharge.`,
    auditId: audit.id,
  };
}

async function leaveForDecision(authed: Authed, id: string) {
  const [leave] = await loadLeaves(db(), authed.ctx.tenantId, { ids: [id] });
  return leave ?? null;
}

export async function decideLeave(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision.");
  const d = parsed.data;
  const leave = await leaveForDecision(authed, d.id);
  if (!leave) return fail("That application no longer exists.");
  if (leave.status !== "pending") return fail(`This application was already ${leave.status}.`);
  const action = `leave.${d.decision === "approved" ? "approve" : "reject"}`;
  if (leave.requestedById === authed.ctx.userId)
    return denied(authed, action, "student_leave", "You can't decide your own application.", leave.id);
  if (!canDecideLeaveIn(authed.ctx, authed.tree, leave.sectionId))
    return denied(
      authed,
      action,
      "student_leave",
      `You can't decide leave for ${leave.sectionLabel}.`,
      leave.id,
    );

  const audit = await successAudit(authed, action, "student_leave", leave.id, {
    student: leave.studentNumber,
    kind: leave.kind,
    fromDate: leave.fromDate,
    toDate: leave.toDate,
    note: d.note ?? null,
  });
  try {
    await withTenant(db(), authed.ctx.tenantId, (q) => [
      q.execute(
        sql`select student_leave_decide(${leave.id}::uuid, ${d.decision}::request_status, ${authed.ctx.userId}::uuid, ${d.note ?? null}, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
      ...notify(q, authed, leave.requestedById, {
        kind: `leave.${d.decision}`,
        title: `Leave ${d.decision}: ${leave.studentName}, ${leave.fromDate} to ${leave.toDate}`,
        body: d.note ? `${authed.ctx.name}: “${d.note}”` : `Decided by ${authed.ctx.name}.`,
        href: "/my/attendance",
      }),
    ]);
  } catch (err) {
    const mapped = decisionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message:
      d.decision === "approved"
        ? `Approved. ${leave.studentName}'s attendance now counts the ${leave.kind === "od" ? "on-duty days as present" : "medical days as excused"}.`
        : `Rejected. ${leave.studentName}'s application is returned with your note.`,
    auditId: audit.id,
  };
}

export async function withdrawLeave(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid application.");
  const leave = await leaveForDecision(authed, parsed.data.id);
  if (!leave) return fail("That application no longer exists.");
  if (leave.requestedById !== authed.ctx.userId)
    return denied(authed, "leave.withdraw", "student_leave", "Only the applicant can withdraw it.", leave.id);
  if (leave.status !== "pending") return fail(`This application was already ${leave.status}.`);
  const audit = await successAudit(authed, "leave.withdraw", "student_leave", leave.id, {
    student: leave.studentNumber,
  });
  try {
    await withTenant(db(), authed.ctx.tenantId, (q) => [
      q.execute(
        sql`select student_leave_decide(${leave.id}::uuid, 'withdrawn'::request_status, ${authed.ctx.userId}::uuid, null, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    const mapped = decisionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return { ok: true, message: "Application withdrawn.", auditId: audit.id };
}

/* ---------- Policy and calendar ---------- */

const thresholdSchema = z.coerce
  .number()
  .int()
  .min(50, "Between 50% and 100%.")
  .max(100, "Between 50% and 100%.");

export async function setInstitutionThreshold(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ thresholdPct: thresholdSchema }).safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid threshold.");
  if (!canSetInstitutionPolicy(authed.ctx, authed.tree))
    return denied(
      authed,
      "attendance.policy.update",
      "tenant",
      "Only institution-wide academic managers can change this.",
    );
  const { thresholdPct } = parsed.data;
  const audit = await successAudit(authed, "attendance.policy.update", "tenant", authed.ctx.tenantId, {
    thresholdPct,
  });
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .insert(s.attendancePolicy)
      .values({ tenantId: authed.ctx.tenantId, thresholdPct, updatedBy: authed.ctx.userId })
      .onConflictDoUpdate({
        target: s.attendancePolicy.tenantId,
        set: { thresholdPct, updatedBy: authed.ctx.userId, updatedAt: sql`now()` },
      }),
    q.insert(s.auditEvent).values(audit),
  ]);
  return { ok: true, message: `Institution threshold set to ${thresholdPct}%.`, auditId: audit.id };
}

export async function setProgrammeThreshold(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      programmeId: z.uuid(),
      thresholdPct: z.union([z.literal("").transform(() => null), thresholdSchema]),
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid threshold.");
  const { programmeId, thresholdPct } = parsed.data;
  const [rows] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({ id: s.programme.id, code: s.programme.code, departmentId: s.programme.departmentId })
      .from(s.programme)
      .where(eq(s.programme.id, programmeId)),
  ]);
  const programme = rows[0];
  if (!programme) return fail("Unknown programme.");
  if (!canSetProgrammeThreshold(authed.ctx, authed.tree, programme.departmentId))
    return denied(
      authed,
      "attendance.programme_threshold.update",
      "programme",
      `You can't change ${programme.code}.`,
      programme.code,
    );
  const audit = await successAudit(
    authed,
    "attendance.programme_threshold.update",
    "programme",
    programme.code,
    {
      thresholdPct,
    },
  );
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .update(s.programme)
      .set({ attendanceThresholdPct: thresholdPct })
      .where(eq(s.programme.id, programme.id)),
    q.insert(s.auditEvent).values(audit),
  ]);
  return {
    ok: true,
    message:
      thresholdPct === null
        ? `${programme.code} now follows the institution threshold.`
        : `${programme.code} threshold set to ${thresholdPct}%.`,
    auditId: audit.id,
  };
}

export async function declareHoliday(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ date: isoDate, name: z.string().trim().min(3, "Name the holiday.").max(80) })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid holiday.");
  const h = parsed.data;
  if (!canDeclareHoliday(authed.ctx, authed.tree))
    return denied(
      authed,
      "holiday.declare",
      "tenant",
      "Only institution-wide academic managers can declare holidays.",
    );
  const c = await attendanceContext(authed);
  if (!c) return fail("There is no current term.");
  if (h.date < c.now.date) return fail("Holidays can be declared for today or later.");
  if (h.date > c.term.endsOn) return fail("That date is after the current term.");
  if (c.holidayDates.has(h.date)) return fail("That day is already a holiday.");
  const [marked] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({ n: sql<number>`count(*)::int` })
      .from(s.classSession)
      .where(and(gte(s.classSession.date, h.date), lte(s.classSession.date, h.date))),
  ]);
  if ((marked[0]?.n ?? 0) > 0)
    return fail(`${marked[0]!.n} classes were already marked that day. Record them as not held instead.`);
  const audit = await successAudit(authed, "holiday.declare", "tenant", h.date, { name: h.name });
  try {
    await withTenant(db(), authed.ctx.tenantId, (q) => [
      q
        .insert(s.holiday)
        .values({ tenantId: authed.ctx.tenantId, date: h.date, name: h.name, createdBy: authed.ctx.userId }),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    if (pgCode(err) === "23505") return fail("That day is already a holiday.");
    throw err;
  }
  return {
    ok: true,
    message: `${h.name} on ${h.date} declared. No classes are expected that day.`,
    auditId: audit.id,
  };
}

export type { Mark };
