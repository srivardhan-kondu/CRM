import { aliasedTable, and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";

/*
 * Assessment and examination loaders: Next-agnostic (integration tests call them), always under RLS via withTenant.
 */

type Db = NeonHttpDatabase<typeof s>;

const sectionUnit = aliasedTable(s.orgUnit, "section_unit");
const submitter = aliasedTable(s.appUser, "submitter");
const decider = aliasedTable(s.appUser, "decider");
const requester = aliasedTable(s.appUser, "requester");

/* ---------- Results (for the student bundle) ---------- */

/** Every published course result of the matching students. Meant to run inside a caller's withTenant batch. */
export function resultQuery(q: Db, studentWhere: SQL) {
  return q
    .select({
      id: s.courseResult.id,
      studentId: s.courseResult.studentId,
      courseCode: s.course.code,
      courseName: s.course.name,
      courseType: s.course.type,
      termCode: s.academicTerm.code,
      termName: s.academicTerm.name,
      eventId: s.courseResult.eventId,
      semester: s.courseResult.semester,
      attempt: s.courseResult.attempt,
      credits: s.courseResult.credits,
      cie: s.courseResult.cie,
      cieMax: s.courseResult.cieMax,
      see: s.courseResult.see,
      seeMax: s.courseResult.seeMax,
      total: s.courseResult.total,
      grade: s.courseResult.grade,
      gradePoint: s.courseResult.gradePoint,
      outcome: s.courseResult.outcome,
      originalSee: s.courseResult.originalSee,
      publishedAt: s.courseResult.publishedAt,
    })
    .from(s.courseResult)
    .innerJoin(s.course, eq(s.course.id, s.courseResult.courseId))
    .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseResult.termId))
    .innerJoin(s.student, eq(s.student.id, s.courseResult.studentId))
    .where(studentWhere)
    .orderBy(asc(s.courseResult.semester), asc(s.course.code), asc(s.courseResult.attempt));
}

export type ResultRow = Awaited<ReturnType<typeof resultQuery>>[number];

/**
 * Standing per student from published results, computed in the database so the student bundle does not transfer
 * every result: each course counts by its latest attempt (rules.ts `standing`). Returns the sums; the caller divides
 * and rounds exactly as the pure rule does.
 */
export function standingQuery(q: Db, studentWhere: SQL) {
  const latest = q
    .selectDistinctOn([s.courseResult.studentId, s.courseResult.courseId], {
      studentId: s.courseResult.studentId,
      credits: s.courseResult.credits,
      gradePoint: s.courseResult.gradePoint,
      outcome: s.courseResult.outcome,
    })
    .from(s.courseResult)
    .innerJoin(s.student, eq(s.student.id, s.courseResult.studentId))
    .where(studentWhere)
    .orderBy(s.courseResult.studentId, s.courseResult.courseId, desc(s.courseResult.attempt))
    .as("latest");
  return q
    .select({
      studentId: latest.studentId,
      credits: sql<number>`sum(${latest.credits})::int`,
      points: sql<number>`sum(${latest.credits} * ${latest.gradePoint})::int`,
      earned: sql<number>`(sum(${latest.credits}) filter (where ${latest.outcome} = 'pass'))::int`,
      backlogs: sql<number>`(count(*) filter (where ${latest.outcome} <> 'pass'))::int`,
    })
    .from(latest)
    .groupBy(latest.studentId);
}

export async function loadResults(db: Db, tenantId: string, studentId: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [resultQuery(q, eq(s.student.id, studentId))]);
  return rows;
}

/* ---------- Internal assessment ---------- */

/** CIE components of a term's offerings (optionally some offerings), with how many students have an entry. */
export async function loadComponents(
  db: Db,
  tenantId: string,
  termId: string,
  offeringIds?: readonly string[],
) {
  if (offeringIds && offeringIds.length === 0) return [];
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.assessmentComponent.id,
        offeringId: s.assessmentComponent.offeringId,
        key: s.assessmentComponent.key,
        label: s.assessmentComponent.label,
        maxMarks: s.assessmentComponent.maxMarks,
        position: s.assessmentComponent.position,
        status: s.assessmentComponent.status,
        submittedById: s.assessmentComponent.submittedBy,
        submittedBy: submitter.name,
        submittedAt: s.assessmentComponent.submittedAt,
        decidedBy: decider.name,
        decidedAt: s.assessmentComponent.decidedAt,
        returnNote: s.assessmentComponent.returnNote,
        entries: sql<number>`(select count(*)::int from assessment_mark m where m.component_id = ${s.assessmentComponent.id})`,
      })
      .from(s.assessmentComponent)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.assessmentComponent.offeringId))
      .leftJoin(submitter, eq(submitter.id, s.assessmentComponent.submittedBy))
      .leftJoin(decider, eq(decider.id, s.assessmentComponent.decidedBy))
      .where(
        and(
          eq(s.courseOffering.termId, termId),
          offeringIds ? inArray(s.assessmentComponent.offeringId, [...offeringIds]) : undefined,
        ),
      )
      .orderBy(asc(s.assessmentComponent.position)),
  ]);
  return rows;
}

export type ComponentRow = Awaited<ReturnType<typeof loadComponents>>[number];

/** Marks of the given components: component id → student id → entry. */
export async function loadMarks(db: Db, tenantId: string, componentIds: readonly string[]) {
  const out = new Map<string, Map<string, { marks: number | null; absent: boolean }>>();
  if (componentIds.length === 0) return out;
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        componentId: s.assessmentMark.componentId,
        studentId: s.assessmentMark.studentId,
        marks: s.assessmentMark.marks,
        absent: s.assessmentMark.absent,
      })
      .from(s.assessmentMark)
      .where(inArray(s.assessmentMark.componentId, [...componentIds])),
  ]);
  for (const r of rows) {
    const byStudent = out.get(r.componentId) ?? new Map();
    byStudent.set(r.studentId, { marks: r.marks, absent: r.absent });
    out.set(r.componentId, byStudent);
  }
  return out;
}

/** Students currently in a section, by roll number. */
export async function loadSectionStudents(db: Db, tenantId: string, sectionId: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.student.id,
        studentNumber: s.student.studentNumber,
        name: s.student.name,
        status: s.student.status,
      })
      .from(s.student)
      .where(eq(s.student.sectionId, sectionId))
      .orderBy(asc(s.student.studentNumber)),
  ]);
  return rows;
}

/* ---------- Examinations ---------- */

export async function loadEvents(db: Db, tenantId: string) {
  const [events, counts] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.examEvent.id,
        code: s.examEvent.code,
        name: s.examEvent.name,
        kind: s.examEvent.kind,
        termId: s.examEvent.termId,
        startsOn: s.examEvent.startsOn,
        endsOn: s.examEvent.endsOn,
        status: s.examEvent.status,
        publishedAt: s.examEvent.publishedAt,
      })
      .from(s.examEvent)
      .orderBy(desc(s.examEvent.startsOn)),
    q
      .select({
        eventId: s.examRegistration.eventId,
        registrations: sql<number>`count(*)::int`,
        entered: sql<number>`(count(*) filter (where ${s.examRegistration.seeMarks} is not null or ${s.examRegistration.seeAbsent}))::int`,
      })
      .from(s.examRegistration)
      .groupBy(s.examRegistration.eventId),
  ]);
  return events.map((e) => {
    const c = counts.find((x) => x.eventId === e.id);
    return { ...e, registrations: c?.registrations ?? 0, entered: c?.entered ?? 0 };
  });
}

export type EventRow = Awaited<ReturnType<typeof loadEvents>>[number];

/** An event's timetable with per-course registration and entry counts. */
export async function loadEventCourses(db: Db, tenantId: string, eventId: string) {
  const [schedule, counts] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        courseId: s.examSchedule.courseId,
        courseCode: s.course.code,
        courseName: s.course.name,
        courseType: s.course.type,
        date: s.examSchedule.date,
        session: s.examSchedule.session,
      })
      .from(s.examSchedule)
      .innerJoin(s.course, eq(s.course.id, s.examSchedule.courseId))
      .where(eq(s.examSchedule.eventId, eventId))
      .orderBy(asc(s.examSchedule.date), asc(s.examSchedule.session), asc(s.course.code)),
    q
      .select({
        courseId: s.examRegistration.courseId,
        registrations: sql<number>`count(*)::int`,
        entered: sql<number>`(count(*) filter (where ${s.examRegistration.seeMarks} is not null or ${s.examRegistration.seeAbsent}))::int`,
      })
      .from(s.examRegistration)
      .where(eq(s.examRegistration.eventId, eventId))
      .groupBy(s.examRegistration.courseId),
  ]);
  return schedule.map((c) => {
    const n = counts.find((x) => x.courseId === c.courseId);
    return { ...c, registrations: n?.registrations ?? 0, entered: n?.entered ?? 0 };
  });
}

export interface RegistrationFilter {
  eventId?: string;
  courseId?: string;
  studentId?: string;
}

export async function loadRegistrations(db: Db, tenantId: string, filter: RegistrationFilter) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.examRegistration.id,
        eventId: s.examRegistration.eventId,
        studentId: s.examRegistration.studentId,
        studentNumber: s.student.studentNumber,
        studentName: s.student.name,
        sectionId: s.student.sectionId,
        sectionCode: sectionUnit.code,
        courseId: s.examRegistration.courseId,
        courseCode: s.course.code,
        courseName: s.course.name,
        courseType: s.course.type,
        credits: s.course.credits,
        termId: s.examRegistration.termId,
        semester: s.examRegistration.semester,
        cieCarried: s.examRegistration.cieCarried,
        seeMax: s.examRegistration.seeMax,
        seeMarks: s.examRegistration.seeMarks,
        seeAbsent: s.examRegistration.seeAbsent,
      })
      .from(s.examRegistration)
      .innerJoin(s.student, eq(s.student.id, s.examRegistration.studentId))
      .innerJoin(sectionUnit, eq(sectionUnit.id, s.student.sectionId))
      .innerJoin(s.course, eq(s.course.id, s.examRegistration.courseId))
      .where(
        and(
          filter.eventId ? eq(s.examRegistration.eventId, filter.eventId) : undefined,
          filter.courseId ? eq(s.examRegistration.courseId, filter.courseId) : undefined,
          filter.studentId ? eq(s.examRegistration.studentId, filter.studentId) : undefined,
        ),
      )
      .orderBy(asc(s.student.studentNumber)),
  ]);
  return rows;
}

export type RegistrationRow = Awaited<ReturnType<typeof loadRegistrations>>[number];

/** CIE totals per (offering → student) for a term: sum of entered marks over its components. */
export async function loadCieTotals(db: Db, tenantId: string, termId: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        offeringId: s.assessmentComponent.offeringId,
        courseId: s.courseOffering.courseId,
        studentId: s.assessmentMark.studentId,
        cie: sql<number>`coalesce(sum(${s.assessmentMark.marks}), 0)::float`,
      })
      .from(s.assessmentMark)
      .innerJoin(s.assessmentComponent, eq(s.assessmentComponent.id, s.assessmentMark.componentId))
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.assessmentComponent.offeringId))
      .where(eq(s.courseOffering.termId, termId))
      .groupBy(s.assessmentComponent.offeringId, s.courseOffering.courseId, s.assessmentMark.studentId),
  ]);
  return rows;
}

/* ---------- Condonation and revaluation ---------- */

export async function loadCondonations(
  db: Db,
  tenantId: string,
  filter: { termId?: string; ids?: string[] } = {},
) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.condonation.id,
        studentId: s.condonation.studentId,
        studentNumber: s.student.studentNumber,
        studentName: s.student.name,
        sectionId: s.student.sectionId,
        sectionCode: sectionUnit.code,
        termId: s.condonation.termId,
        attendancePct: s.condonation.attendancePct,
        reason: s.condonation.reason,
        status: s.condonation.status,
        requestedById: s.condonation.requestedBy,
        requestedBy: requester.name,
        requestedAt: s.condonation.requestedAt,
        decidedBy: decider.name,
        decidedAt: s.condonation.decidedAt,
        decisionNote: s.condonation.decisionNote,
      })
      .from(s.condonation)
      .innerJoin(s.student, eq(s.student.id, s.condonation.studentId))
      .innerJoin(sectionUnit, eq(sectionUnit.id, s.student.sectionId))
      .leftJoin(requester, eq(requester.id, s.condonation.requestedBy))
      .leftJoin(decider, eq(decider.id, s.condonation.decidedBy))
      .where(
        and(
          filter.termId ? eq(s.condonation.termId, filter.termId) : undefined,
          filter.ids ? inArray(s.condonation.id, filter.ids) : undefined,
        ),
      )
      .orderBy(desc(s.condonation.requestedAt)),
  ]);
  return rows;
}

export type CondonationRow = Awaited<ReturnType<typeof loadCondonations>>[number];

export async function loadRevaluations(
  db: Db,
  tenantId: string,
  filter: { ids?: string[]; studentId?: string } = {},
) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.revaluationRequest.id,
        resultId: s.revaluationRequest.resultId,
        status: s.revaluationRequest.status,
        requestedById: s.revaluationRequest.requestedBy,
        requestedAt: s.revaluationRequest.requestedAt,
        revaluedSee: s.revaluationRequest.revaluedSee,
        decidedAt: s.revaluationRequest.decidedAt,
        studentId: s.courseResult.studentId,
        studentNumber: s.student.studentNumber,
        studentName: s.student.name,
        courseCode: s.course.code,
        courseName: s.course.name,
        courseType: s.course.type,
        cie: s.courseResult.cie,
        see: s.courseResult.see,
        seeMax: s.courseResult.seeMax,
        grade: s.courseResult.grade,
      })
      .from(s.revaluationRequest)
      .innerJoin(s.courseResult, eq(s.courseResult.id, s.revaluationRequest.resultId))
      .innerJoin(s.student, eq(s.student.id, s.courseResult.studentId))
      .innerJoin(s.course, eq(s.course.id, s.courseResult.courseId))
      .where(
        and(
          filter.ids ? inArray(s.revaluationRequest.id, filter.ids) : undefined,
          filter.studentId ? eq(s.courseResult.studentId, filter.studentId) : undefined,
        ),
      )
      .orderBy(desc(s.revaluationRequest.requestedAt)),
  ]);
  return rows;
}

export type RevaluationRow = Awaited<ReturnType<typeof loadRevaluations>>[number];
