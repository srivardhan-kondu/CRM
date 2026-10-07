import "server-only";

import { cache } from "react";
import { getDb } from "@/db/client";
import { getCurrentTerm } from "@/domains/academics/context";
import { loadOfferings, loadTerms, type OfferingRow } from "@/domains/academics/load";
import { studentRef, visibleStudents } from "@/domains/students/repository";
import type { Visible } from "@/domains/students/query";
import type { Authed } from "@/lib/authz/context";
import { holdsAnywhere, studentFieldAccess } from "@/lib/authz/engine";
import { institutionNow, institutionToday } from "@/lib/clock";
import {
  canDecideCondonation,
  canEnterMarks,
  canManageExams,
  canModerateIn,
  canRequestCondonationFor,
  canRequestRevaluationFor,
} from "./guards";
import {
  loadComponents,
  loadCondonations,
  loadEventCourses,
  loadEvents,
  loadMarks,
  loadRegistrations,
  loadResults,
  loadRevaluations,
  loadSectionStudents,
  type ComponentRow,
  type EventRow,
  type ResultRow,
} from "./load";
import { eligibilityFor, maySit, revaluationOpen, sgpa, standing, type Eligibility } from "./rules";

/*
 * Assessment and examination reads for the screens, cached per request (keyed by tenant: `Authed` is a fresh object
 * on every requireAuth() call). Every function applies the exam guards.
 */

const db = () => getDb();

const offeringsFor = cache((tenantId: string, termId: string) => loadOfferings(db(), tenantId, termId));
const componentsFor = cache((tenantId: string, termId: string) => loadComponents(db(), tenantId, termId));
const eventsFor = cache((tenantId: string) => loadEvents(db(), tenantId));
const condonationsFor = cache((tenantId: string, termId: string) =>
  loadCondonations(db(), tenantId, { termId }),
);
const termsFor = cache((tenantId: string) => loadTerms(db(), tenantId));

async function currentTerm(authed: Authed) {
  return getCurrentTerm(authed.ctx.tenantId);
}

/* ---------- Internal assessment ---------- */

export interface OfferingAssessment {
  offering: OfferingRow;
  components: ComponentRow[];
  canEnter: boolean;
  canModerate: boolean;
}

function summarizeOffering(
  authed: Authed,
  offering: OfferingRow,
  components: ComponentRow[],
): OfferingAssessment {
  return {
    offering,
    components: components.filter((c) => c.offeringId === offering.id),
    canEnter: canEnterMarks(authed.ctx, authed.tree, offering.sectionId, offering.courseCode),
    canModerate: canModerateIn(authed.ctx, authed.tree, offering.sectionId),
  };
}

/** The viewer's teaching with its components, and the submitted components waiting for their moderation. */
export async function assessmentWorkspace(authed: Authed) {
  const term = await currentTerm(authed);
  if (!term) return null;
  const [offerings, components] = await Promise.all([
    offeringsFor(authed.ctx.tenantId, term.id),
    componentsFor(authed.ctx.tenantId, term.id),
  ]);
  const byId = new Map(offerings.map((o) => [o.id, o]));
  const mine = offerings
    .filter((o) => o.allocations.some((a) => a.userId === authed.ctx.userId))
    .map((o) => summarizeOffering(authed, o, components));
  const toModerate = components
    .filter((c) => c.status === "submitted" && c.submittedById !== authed.ctx.userId)
    .filter((c) => canModerateIn(authed.ctx, authed.tree, byId.get(c.offeringId)!.sectionId))
    .map((c) => ({ component: c, offering: byId.get(c.offeringId)! }));
  const moderator = holdsAnywhere(authed.ctx, "marks:moderate");
  // Department progress for moderators: every component in sections they moderate.
  const progress = moderator
    ? offerings
        .filter((o) => canModerateIn(authed.ctx, authed.tree, o.sectionId))
        .map((o) => summarizeOffering(authed, o, components))
    : [];
  return { term, mine, toModerate, moderator, progress };
}

/** One offering's mark sheet: components, the section's students and their entries. Null when not permitted. */
export async function offeringAssessment(authed: Authed, offeringId: string) {
  const term = await currentTerm(authed);
  if (!term) return null;
  const [offerings, components] = await Promise.all([
    offeringsFor(authed.ctx.tenantId, term.id),
    componentsFor(authed.ctx.tenantId, term.id),
  ]);
  const offering = offerings.find((o) => o.id === offeringId);
  if (!offering) return null;
  const summary = summarizeOffering(authed, offering, components);
  if (!summary.canEnter && !summary.canModerate) return null;
  const [students, marks] = await Promise.all([
    loadSectionStudents(db(), authed.ctx.tenantId, offering.sectionId),
    loadMarks(
      db(),
      authed.ctx.tenantId,
      summary.components.map((c) => c.id),
    ),
  ]);
  return {
    ...summary,
    term,
    students,
    marks: Object.fromEntries(
      summary.components.map((c) => [c.id, Object.fromEntries(marks.get(c.id) ?? new Map())]),
    ) as Record<string, Record<string, { marks: number | null; absent: boolean }>>,
    viewerId: authed.ctx.userId,
  };
}

/* ---------- Eligibility ---------- */

export interface EligibilityRow {
  student: Visible["student"];
  eligibility: Eligibility;
  condonation: { id: string; status: string; reason: string } | null;
  maySit: boolean;
}

/** Current-term eligibility of the students the viewer may see academically. */
export async function eligibility(authed: Authed): Promise<EligibilityRow[] | null> {
  const term = await currentTerm(authed);
  if (!term) return null;
  const [students, condonations] = await Promise.all([
    visibleStudents(authed),
    condonationsFor(authed.ctx.tenantId, term.id),
  ]);
  const open = new Map(
    condonations
      .filter((c) => c.status === "pending" || c.status === "approved")
      .map((c) => [c.studentId, c]),
  );
  return students
    .filter((v) => v.access.academic && v.student.status === "active")
    .map((v) => {
      const e = eligibilityFor(v.student.attendancePct, v.student.attendanceThreshold);
      const c = open.get(v.student.id) ?? null;
      return {
        student: v.student,
        eligibility: e,
        condonation: c ? { id: c.id, status: c.status, reason: c.reason } : null,
        maySit: maySit(e, c?.status === "approved"),
      };
    });
}

/** Condonation requests of the current term for the deciding authority (CoE, principal). */
export async function condonationQueue(authed: Authed) {
  const term = await currentTerm(authed);
  if (!term || !canDecideCondonation(authed.ctx, authed.tree)) return null;
  const list = await condonationsFor(authed.ctx.tenantId, term.id);
  return list.map((c) => ({
    ...c,
    requestedAt: c.requestedAt.toISOString(),
    decidedAt: c.decidedAt?.toISOString() ?? null,
    canDecide: c.status === "pending" && c.requestedById !== authed.ctx.userId,
  }));
}

/* ---------- Examinations ---------- */

export function canOpenExams(authed: Authed) {
  return canManageExams(authed.ctx, authed.tree) || canDecideCondonation(authed.ctx, authed.tree);
}

export interface EventSummary extends EventRow {
  /** For a regular exam: internal components approved ÷ all, across its term's offerings. */
  cie: { approved: number; total: number } | null;
}

export async function examEvents(authed: Authed): Promise<EventSummary[] | null> {
  if (!canOpenExams(authed)) return null;
  const events = await eventsFor(authed.ctx.tenantId);
  return Promise.all(
    events.map(async (e) => {
      if (e.kind !== "regular" || !e.termId) return { ...e, cie: null };
      const components = await componentsFor(authed.ctx.tenantId, e.termId);
      return {
        ...e,
        cie: { approved: components.filter((c) => c.status === "approved").length, total: components.length },
      };
    }),
  );
}

/**
 * Everything the exam cell needs to run one event: timetable with entry progress, and what still blocks publishing.
 * For a regular exam, students who may not sit are not expected to have marks.
 */
export async function examEvent(authed: Authed, eventId: string) {
  const events = await examEvents(authed);
  const event = events?.find((e) => e.id === eventId);
  if (!event) return null;
  const [courses, registrations] = await Promise.all([
    loadEventCourses(db(), authed.ctx.tenantId, eventId),
    loadRegistrations(db(), authed.ctx.tenantId, { eventId }),
  ]);
  const sitting = await sittingMap(authed, event);
  const pending = registrations.filter(
    (r) => sitting(r.studentId) && r.seeMarks === null && !r.seeAbsent,
  ).length;
  const blockers: string[] = [];
  if (event.status === "published") blockers.push("Already published.");
  if (event.cie && event.cie.approved < event.cie.total)
    blockers.push(
      `${event.cie.total - event.cie.approved} internal assessment components are not yet approved.`,
    );
  if (pending > 0) blockers.push(`${pending} semester-end marks are still to be entered.`);
  const today = institutionToday().date;
  if (event.endsOn > today) blockers.push(`The examinations run until ${event.endsOn}.`);
  return {
    event,
    courses,
    pending,
    blockers,
    canManage: canManageExams(authed.ctx, authed.tree),
    today,
  };
}

/** For a regular exam, whether each student may sit (attendance + condonation); everyone sits a supplementary. */
async function sittingMap(authed: Authed, event: EventRow): Promise<(studentId: string) => boolean> {
  if (event.kind !== "regular") return () => true;
  const rows = (await eligibility(authed)) ?? [];
  const sits = new Map(rows.map((r) => [r.student.id, r.maySit]));
  return (studentId) => sits.get(studentId) ?? true;
}

/** One course's semester-end mark sheet in an event. */
export async function examMarkSheet(authed: Authed, eventId: string, courseId: string) {
  const detail = await examEvent(authed, eventId);
  if (!detail) return null;
  const course = detail.courses.find((c) => c.courseId === courseId);
  if (!course) return null;
  const registrations = await loadRegistrations(db(), authed.ctx.tenantId, { eventId, courseId });
  const sitting = await sittingMap(authed, detail.event);
  return {
    ...detail,
    course,
    held: course.date <= detail.today,
    rows: registrations.map((r) => ({ ...r, maySit: sitting(r.studentId) })),
  };
}

/** Pending and recent revaluation requests for the exam cell. */
export async function revaluationQueue(authed: Authed) {
  if (!canManageExams(authed.ctx, authed.tree)) return null;
  const rows = await loadRevaluations(db(), authed.ctx.tenantId);
  return rows.map((r) => ({
    ...r,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
}

/* ---------- A student's own view ---------- */

export interface SemesterResults {
  semester: number;
  termCode: string;
  termName: string;
  sgpa: number;
  credits: number;
  results: (ResultRow & { revaluation: { status: string } | null; canRevalue: boolean })[];
}

/** Published results grouped by semester (latest attempt per course shown, earlier attempts listed). */
export async function studentAcademics(authed: Authed, v: Visible) {
  const access = studentFieldAccess(authed.ctx, authed.tree, studentRef(v.student, authed.ctx.tenantId));
  if (!access.academic) return null;
  const [results, revaluations] = await Promise.all([
    loadResults(db(), authed.ctx.tenantId, v.student.id),
    loadRevaluations(db(), authed.ctx.tenantId, { studentId: v.student.id }),
  ]);
  const now = institutionNow();
  const mayRequest = canRequestRevaluationFor(
    authed.ctx,
    authed.tree,
    studentRef(v.student, authed.ctx.tenantId),
  );
  const latestAttempt = new Map<string, number>();
  for (const r of results)
    latestAttempt.set(r.courseCode, Math.max(latestAttempt.get(r.courseCode) ?? 0, r.attempt));
  const revalByResult = new Map(
    revaluations.filter((x) => x.status !== "withdrawn").map((x) => [x.resultId, x]),
  );
  const bySemester = new Map<number, SemesterResults>();
  for (const r of results) {
    const entry =
      bySemester.get(r.semester) ??
      ({
        semester: r.semester,
        termCode: r.termCode,
        termName: r.termName,
        sgpa: 0,
        credits: 0,
        results: [],
      } as SemesterResults);
    const reval = revalByResult.get(r.id) ?? null;
    entry.results.push({
      ...r,
      revaluation: reval ? { status: reval.status } : null,
      canRevalue:
        mayRequest &&
        !reval &&
        r.courseType === "theory" &&
        r.see !== null &&
        r.attempt === latestAttempt.get(r.courseCode) &&
        revaluationOpen(r.publishedAt, now),
    });
    bySemester.set(r.semester, entry);
  }
  const semesters = [...bySemester.values()].sort((a, b) => a.semester - b.semester);
  for (const sem of semesters) {
    // SGPA counts each course's first (regular) attempt in its semester.
    const firstAttempts = sem.results.filter((r) => r.attempt === 1);
    sem.sgpa = sgpa(firstAttempts);
    sem.credits = firstAttempts.reduce((n, r) => n + r.credits, 0);
  }
  return { semesters, standing: standing(results), now: now.toISOString() };
}

/** The student's examinations: the regular timetable for their courses with eligibility, and supplementary sittings. */
export async function studentExams(authed: Authed, v: Visible) {
  const access = studentFieldAccess(authed.ctx, authed.tree, studentRef(v.student, authed.ctx.tenantId));
  if (!access.academic) return null;
  const term = await currentTerm(authed);
  const [events, registrations, condonations] = await Promise.all([
    eventsFor(authed.ctx.tenantId),
    loadRegistrations(db(), authed.ctx.tenantId, { studentId: v.student.id }),
    term ? condonationsFor(authed.ctx.tenantId, term.id) : Promise.resolve([]),
  ]);
  const e = eligibilityFor(v.student.attendancePct, v.student.attendanceThreshold);
  const cond = condonations.find(
    (c) => c.studentId === v.student.id && (c.status === "pending" || c.status === "approved"),
  );
  const ref = studentRef(v.student, authed.ctx.tenantId);
  const sittings = await Promise.all(
    events
      .filter((ev) => registrations.some((r) => r.eventId === ev.id))
      .map(async (ev) => {
        const schedule = await loadEventCourses(db(), authed.ctx.tenantId, ev.id);
        const mine = registrations.filter((r) => r.eventId === ev.id);
        return {
          event: ev,
          papers: mine
            .map((r) => ({ ...r, slot: schedule.find((x) => x.courseId === r.courseId) ?? null }))
            .sort((a, b) =>
              `${a.slot?.date}${a.slot?.session}`.localeCompare(`${b.slot?.date}${b.slot?.session}`),
            ),
        };
      }),
  );
  const terms = await termsFor(authed.ctx.tenantId);
  return {
    sittings,
    eligibility: e,
    condonation: cond ? { status: cond.status, reason: cond.reason } : null,
    maySit: maySit(e, cond?.status === "approved"),
    canRequestCondonation:
      e === "condonable" && !cond && canRequestCondonationFor(authed.ctx, authed.tree, ref),
    termName: term?.name ?? null,
    termNames: new Map(terms.map((t) => [t.id, t.name])),
  };
}
