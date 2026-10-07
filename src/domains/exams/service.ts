import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getCurrentTerm } from "@/domains/academics/context";
import { loadOfferings } from "@/domains/academics/load";
import { notify } from "@/domains/notifications/notify";
import { loadStudentById } from "@/domains/students/load";
import { studentRef } from "@/domains/students/repository";
import { denied, fail, successAudit, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import {
  canDecideCondonation,
  canEnterMarks,
  canManageExams,
  canModerateIn,
  canRequestCondonationFor,
  canRequestRevaluationFor,
} from "./guards";
import { loadCieTotals, loadComponents, loadCondonations, loadRegistrations, loadRevaluations } from "./load";
import { eligibility, examEvent } from "./repository";
import {
  cieMax,
  eligibilityFor,
  gradeCourse,
  revaluationOpen,
  revaluedSee,
  seeMax,
  validMark,
  type CourseType,
} from "./rules";

/*
 * Assessment and examination mutations. Each authorizes with the exam guards, validates, then writes the change and its
 * audit event in one transaction under RLS. State transitions go through database functions (migration 0009) that lock
 * and re-check, so a second decision fails instead of applying twice.
 */

const db = () => getDb();

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

function transitionError(err: unknown): ActionResult | null {
  const code = pgCode(err);
  if (code === "55000") return fail("Someone has changed this in the meantime — reload and check.");
  if (code === "23514") return fail("Some entries are missing or out of range.");
  if (code === "42501") return fail("You can't do that to your own work.");
  return null;
}

type Db = ReturnType<typeof getDb>;

/** One transaction under RLS: the state change and its audit row (callers always pass at least two statements). */
function run(authed: Authed, statements: (q: Db) => [BatchItem<"pg">, ...BatchItem<"pg">[]]) {
  return withTenant(db(), authed.ctx.tenantId, statements);
}

const entrySchema = z.object({
  marks: z.number().nullable(),
  absent: z.boolean(),
});

/* ---------- Internal assessment ---------- */

async function componentContext(authed: Authed, componentId: string) {
  const term = await getCurrentTerm(authed.ctx.tenantId);
  if (!term) return null;
  const [components, offerings] = await Promise.all([
    loadComponents(db(), authed.ctx.tenantId, term.id),
    loadOfferings(db(), authed.ctx.tenantId, term.id),
  ]);
  const component = components.find((c) => c.id === componentId);
  const offering = component && offerings.find((o) => o.id === component.offeringId);
  return component && offering ? { component, offering } : null;
}

export async function saveMarks(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ componentId: z.uuid(), entries: z.record(z.uuid(), entrySchema) })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid marks.");
  const cx = await componentContext(authed, parsed.data.componentId);
  if (!cx) return fail("Unknown assessment.");
  const { component, offering } = cx;
  const label = `${component.label} · ${offering.courseCode} ${offering.sectionLabel}`;
  if (!canEnterMarks(authed.ctx, authed.tree, offering.sectionId, offering.courseCode))
    return denied(
      authed,
      "marks.save",
      "assessment_component",
      `You don't assess ${offering.courseCode} for ${offering.sectionLabel}.`,
      component.id,
    );
  if (component.status !== "open")
    return fail(
      component.status === "approved"
        ? "These marks are approved and locked."
        : "These marks are with the HOD for moderation.",
    );
  for (const e of Object.values(parsed.data.entries))
    if (!e.absent && e.marks !== null && !validMark(e.marks, component.maxMarks))
      return fail(`Marks must be between 0 and ${component.maxMarks}, in steps of 0.5.`);

  const entered = Object.values(parsed.data.entries).filter((e) => e.absent || e.marks !== null).length;
  const audit = await successAudit(authed, "marks.save", "assessment_component", component.id, {
    component: component.key,
    course: offering.courseCode,
    section: offering.sectionLabel,
    entries: entered,
  });
  try {
    await run(authed, (q) => [
      q.execute(
        sql`select assessment_marks_save(${component.id}::uuid, ${JSON.stringify(parsed.data.entries)}::jsonb, ${authed.ctx.userId}::uuid, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return { ok: true, message: `${label}: ${entered} entries saved.`, auditId: audit.id };
}

export async function submitComponent(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ componentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid assessment.");
  const cx = await componentContext(authed, parsed.data.componentId);
  if (!cx) return fail("Unknown assessment.");
  const { component, offering } = cx;
  if (!canEnterMarks(authed.ctx, authed.tree, offering.sectionId, offering.courseCode))
    return denied(
      authed,
      "marks.submit",
      "assessment_component",
      `You don't assess ${offering.courseCode} for ${offering.sectionLabel}.`,
      component.id,
    );
  const audit = await successAudit(authed, "marks.submit", "assessment_component", component.id, {
    component: component.key,
    course: offering.courseCode,
    section: offering.sectionLabel,
  });
  try {
    await run(authed, (q) => [
      q.execute(
        sql`select assessment_component_transition(${component.id}::uuid, 'open', 'submitted', ${authed.ctx.userId}::uuid, null, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    if (pgCode(err) === "23514")
      return fail("Enter marks (or mark absent) for every student before submitting.");
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message: `${component.label} for ${offering.courseCode} · ${offering.sectionLabel} submitted to the HOD.`,
    auditId: audit.id,
  };
}

export async function moderateComponent(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      componentId: z.uuid(),
      decision: z.enum(["approved", "returned"]),
      note: z.string().trim().max(500).optional(),
    })
    .refine((d) => d.decision === "approved" || (d.note ?? "").length >= 3, {
      message: "Say what needs fixing when returning marks.",
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision.");
  const d = parsed.data;
  const cx = await componentContext(authed, d.componentId);
  if (!cx) return fail("Unknown assessment.");
  const { component, offering } = cx;
  const action = d.decision === "approved" ? "marks.approve" : "marks.return";
  if (component.submittedById === authed.ctx.userId)
    return denied(
      authed,
      action,
      "assessment_component",
      "You can't moderate marks you submitted.",
      component.id,
    );
  if (!canModerateIn(authed.ctx, authed.tree, offering.sectionId))
    return denied(
      authed,
      action,
      "assessment_component",
      `You don't moderate ${offering.sectionLabel}.`,
      component.id,
    );
  const audit = await successAudit(authed, action, "assessment_component", component.id, {
    component: component.key,
    course: offering.courseCode,
    section: offering.sectionLabel,
    note: d.note ?? null,
  });
  try {
    await run(authed, (q) => [
      q.execute(
        sql`select assessment_component_transition(${component.id}::uuid, 'submitted', ${d.decision === "approved" ? "approved" : "open"}::component_status, ${authed.ctx.userId}::uuid, ${d.note ?? null}, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
      ...notify(q, authed, component.submittedById, {
        kind: `marks.${d.decision === "approved" ? "approved" : "returned"}`,
        title: `${component.label} · ${offering.courseCode} ${offering.sectionLabel} ${d.decision === "approved" ? "approved" : "returned"}`,
        body: d.note
          ? `${authed.ctx.name}: “${d.note}”`
          : `Approved by ${authed.ctx.name}; the marks are locked.`,
        href: `/marks/${offering.id}`,
      }),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  const label = `${component.label} · ${offering.courseCode} ${offering.sectionLabel}`;
  return {
    ok: true,
    message:
      d.decision === "approved"
        ? `${label} approved and locked.`
        : `${label} returned to ${component.submittedBy ?? "the teacher"}.`,
    auditId: audit.id,
  };
}

/* ---------- Semester-end marks ---------- */

export async function saveSeeMarks(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ eventId: z.uuid(), courseId: z.uuid(), entries: z.record(z.uuid(), entrySchema) })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid marks.");
  const { eventId, courseId, entries } = parsed.data;
  if (!canManageExams(authed.ctx, authed.tree))
    return denied(
      authed,
      "exam.marks.save",
      "exam_event",
      "Only the examination cell enters semester-end marks.",
      eventId,
    );
  const detail = await examEvent(authed, eventId);
  const course = detail?.courses.find((c) => c.courseId === courseId);
  if (!detail || !course) return fail("Unknown exam paper.");
  if (detail.event.status === "published")
    return fail("Results are published; marks can only change through revaluation.");
  if (course.date > detail.today)
    return fail(`${course.courseCode} is examined on ${course.date}; enter marks after it.`);
  const registrations = await loadRegistrations(db(), authed.ctx.tenantId, { eventId, courseId });
  const known = new Map(registrations.map((r) => [r.id, r]));
  for (const [id, e] of Object.entries(entries)) {
    const r = known.get(id);
    if (!r) return fail("Some entries are not registrations for this paper.");
    if (!e.absent && e.marks !== null && !validMark(e.marks, r.seeMax))
      return fail(`Marks must be between 0 and ${r.seeMax}, in steps of 0.5.`);
  }
  const filled = Object.fromEntries(Object.entries(entries).filter(([, e]) => e.absent || e.marks !== null));
  const audit = await successAudit(authed, "exam.marks.save", "exam_event", detail.event.code, {
    course: course.courseCode,
    entries: Object.keys(filled).length,
  });
  try {
    await run(authed, (q) => [
      q.execute(
        sql`select exam_marks_save(${eventId}::uuid, ${courseId}::uuid, ${JSON.stringify(filled)}::jsonb, ${authed.ctx.userId}::uuid, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message: `${course.courseCode}: ${Object.keys(filled).length} semester-end marks saved.`,
    auditId: audit.id,
  };
}

/* ---------- Publishing ---------- */

/**
 * Publishes an event's results: grades every registration (rules.ts) into course_result, in one transaction with the
 * status change. A regular exam takes internal marks from the term's approved components; students who may not sit
 * are recorded as not eligible. A supplementary sitting carries internal marks over and counts as the next attempt.
 */
export async function publishResults(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ eventId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid exam.");
  if (!canManageExams(authed.ctx, authed.tree))
    return denied(
      authed,
      "exam.publish",
      "exam_event",
      "Only the examination cell publishes results.",
      parsed.data.eventId,
    );
  const detail = await examEvent(authed, parsed.data.eventId);
  if (!detail) return fail("Unknown exam.");
  const { event } = detail;
  if (detail.blockers.length) return fail(`Not ready to publish: ${detail.blockers.join(" ")}`);

  const registrations = await loadRegistrations(db(), authed.ctx.tenantId, { eventId: event.id });
  const sits = new Map<string, boolean>();
  if (event.kind === "regular")
    for (const r of (await eligibility(authed)) ?? []) sits.set(r.student.id, r.maySit);
  const cie = new Map<string, number>();
  if (event.kind === "regular" && event.termId)
    for (const t of await loadCieTotals(db(), authed.ctx.tenantId, event.termId))
      cie.set(`${t.studentId}|${t.courseId}`, t.cie);
  const [prior] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({
        studentId: s.courseResult.studentId,
        courseId: s.courseResult.courseId,
        termId: s.courseResult.termId,
        attempt: sql<number>`max(${s.courseResult.attempt})::int`,
      })
      .from(s.courseResult)
      .where(
        inArray(
          s.courseResult.studentId,
          registrations.map((r) => r.studentId),
        ),
      )
      .groupBy(s.courseResult.studentId, s.courseResult.courseId, s.courseResult.termId),
  ]);
  const attempts = new Map(prior.map((p) => [`${p.studentId}|${p.courseId}|${p.termId}`, p.attempt]));
  const at = institutionNow();
  const rows = registrations.map((r) => {
    const type = r.courseType as CourseType;
    const internal = r.cieCarried ?? cie.get(`${r.studentId}|${r.courseId}`) ?? 0;
    const g = gradeCourse({
      type,
      cie: internal,
      see: r.seeMarks,
      seeAbsent: r.seeAbsent,
      eligible: event.kind === "regular" ? (sits.get(r.studentId) ?? true) : true,
    });
    return {
      tenantId: authed.ctx.tenantId,
      studentId: r.studentId,
      courseId: r.courseId,
      termId: r.termId,
      eventId: event.id,
      semester: r.semester,
      attempt: (attempts.get(`${r.studentId}|${r.courseId}|${r.termId}`) ?? 0) + 1,
      credits: r.credits,
      cie: internal,
      cieMax: cieMax(type),
      see: g.outcome === "not_eligible" || g.outcome === "absent" ? null : r.seeMarks,
      seeMax: seeMax(type),
      total: g.total,
      grade: g.grade,
      gradePoint: g.gradePoint,
      outcome: g.outcome,
      publishedAt: at,
    };
  });
  const passed = rows.filter((r) => r.outcome === "pass").length;
  const audit = await successAudit(authed, "exam.publish", "exam_event", event.code, {
    results: rows.length,
    passed,
  });
  try {
    await run(authed, (q) => [
      q.execute(
        sql`select exam_event_publish(${event.id}::uuid, ${authed.ctx.userId}::uuid, ${at.toISOString()}::timestamptz)`,
      ),
      ...(rows.length ? [q.insert(s.courseResult).values(rows)] : []),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message: `${event.name}: ${rows.length} results published, ${passed} passed. Revaluation is open for 7 days.`,
    auditId: audit.id,
  };
}

/* ---------- Condonation ---------- */

export async function requestCondonation(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      studentId: z.uuid(),
      reason: z.string().trim().min(10, "Give the reason in a sentence.").max(500),
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request.");
  const term = await getCurrentTerm(authed.ctx.tenantId);
  if (!term) return fail("There is no current term.");
  const bundle = await loadStudentById(db(), authed.ctx.tenantId, parsed.data.studentId);
  const st = bundle.students[0];
  if (!st) return fail("Unknown student.");
  if (!canRequestCondonationFor(authed.ctx, authed.tree, studentRef(st, authed.ctx.tenantId)))
    return denied(
      authed,
      "condonation.request",
      "student",
      "You can't request condonation for this student.",
      st.studentNumber,
    );
  const e = eligibilityFor(st.attendancePct, st.attendanceThreshold);
  if (e === "eligible") return fail(`${st.name} is already eligible on attendance.`);
  if (e === "not_eligible")
    return fail(
      `${st.name}'s attendance (${st.attendancePct}%) is below the condonation band; they cannot sit this term.`,
    );
  const id = crypto.randomUUID();
  const audit = await successAudit(authed, "condonation.request", "condonation", id, {
    student: st.studentNumber,
    attendancePct: st.attendancePct,
  });
  try {
    await run(authed, (q) => [
      q.insert(s.condonation).values({
        id,
        tenantId: authed.ctx.tenantId,
        studentId: st.id,
        termId: term.id,
        attendancePct: st.attendancePct,
        reason: parsed.data.reason,
        requestedBy: authed.ctx.userId,
        requestedAt: institutionNow(),
      }),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    if (pgCode(err) === "23505") return fail(`${st.name} already has a condonation request this term.`);
    throw err;
  }
  return {
    ok: true,
    message: `Condonation for ${st.name} sent to the Controller of Examinations.`,
    auditId: audit.id,
  };
}

export async function decideCondonation(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({
      id: z.uuid(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(500).optional(),
    })
    .refine((d) => d.decision === "approved" || (d.note ?? "").length >= 3, {
      message: "Give a reason when rejecting.",
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid decision.");
  const d = parsed.data;
  const [c] = await loadCondonations(db(), authed.ctx.tenantId, { ids: [d.id] });
  if (!c) return fail("Unknown request.");
  const action = `condonation.${d.decision === "approved" ? "approve" : "reject"}`;
  if (c.requestedById === authed.ctx.userId)
    return denied(authed, action, "condonation", "You can't decide your own request.", c.id);
  if (!canDecideCondonation(authed.ctx, authed.tree))
    return denied(
      authed,
      action,
      "condonation",
      "Only the Controller of Examinations or the principal decides condonation.",
      c.id,
    );
  const audit = await successAudit(authed, action, "condonation", c.id, {
    student: c.studentNumber,
    note: d.note ?? null,
  });
  try {
    await run(authed, (q) => [
      q.execute(
        sql`select condonation_decide(${c.id}::uuid, ${d.decision}::request_status, ${authed.ctx.userId}::uuid, ${d.note ?? null}, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      q.insert(s.auditEvent).values(audit),
      ...notify(q, authed, c.requestedById, {
        kind: `condonation.${d.decision}`,
        title: `Condonation ${d.decision}: ${c.studentName}`,
        body: d.note ? `${authed.ctx.name}: “${d.note}”` : `Decided by ${authed.ctx.name}.`,
      }),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message:
      d.decision === "approved"
        ? `Condoned: ${c.studentName} may sit the semester-end examinations.`
        : `Rejected: ${c.studentName} is not eligible this term.`,
    auditId: audit.id,
  };
}

/* ---------- Revaluation ---------- */

async function resultById(authed: Authed, resultId: string) {
  const [rows] = await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .select({
        id: s.courseResult.id,
        studentId: s.courseResult.studentId,
        courseId: s.courseResult.courseId,
        termId: s.courseResult.termId,
        attempt: s.courseResult.attempt,
        cie: s.courseResult.cie,
        see: s.courseResult.see,
        seeMax: s.courseResult.seeMax,
        publishedAt: s.courseResult.publishedAt,
        courseCode: s.course.code,
        courseType: s.course.type,
        latest: sql<boolean>`${s.courseResult.attempt} = (select max(attempt) from course_result x where x.student_id = ${s.courseResult.studentId} and x.course_id = ${s.courseResult.courseId})`,
      })
      .from(s.courseResult)
      .innerJoin(s.course, eq(s.course.id, s.courseResult.courseId))
      .where(eq(s.courseResult.id, resultId)),
  ]);
  return rows[0] ?? null;
}

export async function requestRevaluation(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ resultId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid result.");
  const r = await resultById(authed, parsed.data.resultId);
  if (!r) return fail("Unknown result.");
  const bundle = await loadStudentById(db(), authed.ctx.tenantId, r.studentId);
  const st = bundle.students[0]!;
  if (!canRequestRevaluationFor(authed.ctx, authed.tree, studentRef(st, authed.ctx.tenantId)))
    return denied(
      authed,
      "revaluation.request",
      "course_result",
      "You can't request revaluation for this result.",
      r.id,
    );
  if (r.courseType !== "theory" || r.see === null)
    return fail("Revaluation covers theory semester-end scripts only.");
  if (!r.latest) return fail("Only your latest attempt can be revalued.");
  if (!revaluationOpen(r.publishedAt, institutionNow()))
    return fail("The 7-day revaluation window has closed.");
  const id = crypto.randomUUID();
  const audit = await successAudit(authed, "revaluation.request", "course_result", r.id, {
    student: st.studentNumber,
    course: r.courseCode,
  });
  try {
    await run(authed, (q) => [
      q.insert(s.revaluationRequest).values({
        id,
        tenantId: authed.ctx.tenantId,
        resultId: r.id,
        requestedBy: authed.ctx.userId,
        requestedAt: institutionNow(),
      }),
      q.insert(s.auditEvent).values(audit),
    ]);
  } catch (err) {
    if (pgCode(err) === "23505") return fail("Revaluation of this script is already requested.");
    throw err;
  }
  return {
    ok: true,
    message: `Revaluation of ${r.courseCode} requested. The higher of the two marks will stand.`,
    auditId: audit.id,
  };
}

export async function completeRevaluation(authed: Authed, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid(), revaluedSee: z.coerce.number() }).safeParse(input);
  if (!parsed.success) return fail("Enter the revalued mark.");
  const [req] = await loadRevaluations(db(), authed.ctx.tenantId, { ids: [parsed.data.id] });
  if (!req) return fail("Unknown request.");
  if (!canManageExams(authed.ctx, authed.tree))
    return denied(
      authed,
      "revaluation.complete",
      "revaluation_request",
      "Only the examination cell records revaluation.",
      req.id,
    );
  if (req.status !== "pending") return fail(`This revaluation is already ${req.status}.`);
  if (!validMark(parsed.data.revaluedSee, req.seeMax))
    return fail(`Marks must be between 0 and ${req.seeMax}.`);
  const r = (await resultById(authed, req.resultId))!;
  const see = revaluedSee(r.see ?? 0, parsed.data.revaluedSee);
  const g = gradeCourse({ type: r.courseType as CourseType, cie: r.cie, see });
  const audit = await successAudit(authed, "revaluation.complete", "revaluation_request", req.id, {
    student: req.studentNumber,
    course: req.courseCode,
    original: r.see,
    revalued: parsed.data.revaluedSee,
    awarded: see,
  });
  const changed = see !== r.see;
  try {
    await run(authed, (q) => [
      q.execute(
        sql`select revaluation_complete(${req.id}::uuid, ${parsed.data.revaluedSee}::numeric, ${authed.ctx.userId}::uuid, ${institutionNow().toISOString()}::timestamptz)`,
      ),
      ...(changed
        ? [
            q
              .update(s.courseResult)
              .set({
                see,
                total: g.total,
                grade: g.grade,
                gradePoint: g.gradePoint,
                outcome: g.outcome,
                originalSee: r.see,
              })
              .where(and(eq(s.courseResult.id, r.id))),
          ]
        : []),
      q.insert(s.auditEvent).values(audit),
      ...notify(q, authed, req.requestedById, {
        kind: "revaluation.completed",
        title: `Revaluation of ${req.courseCode} completed`,
        body: changed
          ? `Your mark is now ${see}/${req.seeMax}, grade ${g.grade}.`
          : "The original mark stands.",
        href: "/my/academics",
      }),
    ]);
  } catch (err) {
    const mapped = transitionError(err);
    if (mapped) return mapped;
    throw err;
  }
  return {
    ok: true,
    message: changed
      ? `${req.courseCode} for ${req.studentName}: revalued to ${see}/${req.seeMax}, grade ${g.grade}.`
      : `${req.courseCode} for ${req.studentName}: the original mark stands (${r.see}/${req.seeMax}).`,
    auditId: audit.id,
  };
}
