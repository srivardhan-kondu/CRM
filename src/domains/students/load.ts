import { aliasedTable, and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { policyQuery, talliesByStudent, tallyQuery } from "@/domains/attendance/load";
import { DEFAULT_THRESHOLD_PCT, type Tally } from "@/domains/attendance/rules";
import { standingQuery } from "@/domains/exams/load";
import { standingFromSums } from "@/domains/exams/rules";
import { attendanceFields, DEMO_NOW, evaluateRisk, syntheticSignals } from "@/lib/demo/fixtures";
import { placementInTerm, type StudentScope } from "./scope";
import type { Guardian, Student, SubjectAttendance } from "./types";

/*
 * Student loaders: Next-agnostic (integration tests call them directly) and always under RLS via withTenant.
 * They assemble the domain `Student` from the record, its placement, the current term, its recorded attendance and its
 * published results; fees are a synthetic signal until Phase 7 (fixtures.ts).
 */

type Db = NeonHttpDatabase<typeof s>;

export interface CurrentTerm {
  id: string;
  code: string;
  name: string;
  kind: "odd" | "even" | "summer";
  startsOn: string;
  endsOn: string;
  academicYearCode: string;
  academicYearStart: number;
}

const sectionUnit = aliasedTable(s.orgUnit, "section_unit");
const departmentUnit = aliasedTable(s.orgUnit, "department_unit");
const mentor = aliasedTable(s.appUser, "mentor");

function termQuery(q: Db) {
  return q
    .select({
      id: s.academicTerm.id,
      code: s.academicTerm.code,
      name: s.academicTerm.name,
      kind: s.academicTerm.kind,
      startsOn: s.academicTerm.startsOn,
      endsOn: s.academicTerm.endsOn,
      academicYearCode: s.academicYear.code,
      academicYearStartsOn: s.academicYear.startsOn,
    })
    .from(s.academicTerm)
    .innerJoin(s.academicYear, eq(s.academicYear.id, s.academicTerm.academicYearId))
    .where(eq(s.academicTerm.isCurrent, true));
}

function toTerm(rows: Awaited<ReturnType<typeof termQuery>>): CurrentTerm | null {
  const t = rows[0];
  return t ? { ...t, academicYearStart: Number(t.academicYearStartsOn.slice(0, 4)) } : null;
}

export async function loadCurrentTerm(db: Db, tenantId: string): Promise<CurrentTerm | null> {
  const [rows] = await withTenant(db, tenantId, (q) => [termQuery(q)]);
  return toTerm(rows);
}

export function scopeCondition(scope: StudentScope): SQL {
  if (scope.all) return sql`true`;
  return or(
    inArray(s.student.sectionId, scope.sectionIds),
    inArray(s.student.studentNumber, scope.studentNumbers),
  )!;
}

function studentQuery(q: Db, where: SQL) {
  return q
    .select({
      id: s.student.id,
      studentNumber: s.student.studentNumber,
      name: s.student.name,
      gender: s.student.gender,
      email: s.student.email,
      phone: s.student.phone,
      status: s.student.status,
      admittedOn: s.student.admittedOn,
      hosteller: s.student.hosteller,
      sectionOrgId: s.student.sectionId,
      sectionCode: sectionUnit.code,
      sectionLabel: s.section.label,
      departmentCode: departmentUnit.code,
      programmeCode: s.programme.code,
      programmeName: s.programme.name,
      durationYears: s.programme.durationYears,
      attendanceThresholdPct: s.programme.attendanceThresholdPct,
      batchCode: s.batch.code,
      batchName: s.batch.name,
      admissionYear: s.batch.admissionYear,
      graduationYear: s.batch.graduationYear,
      curriculumId: s.batch.curriculumId,
      regulationCode: s.curriculum.code,
      regulationName: s.curriculum.name,
      mentorName: mentor.name,
    })
    .from(s.student)
    .innerJoin(s.programme, eq(s.programme.id, s.student.programmeId))
    .innerJoin(departmentUnit, eq(departmentUnit.id, s.programme.departmentId))
    .innerJoin(s.batch, eq(s.batch.id, s.student.batchId))
    .innerJoin(s.curriculum, eq(s.curriculum.id, s.batch.curriculumId))
    .innerJoin(s.section, eq(s.section.orgUnitId, s.student.sectionId))
    .innerJoin(sectionUnit, eq(sectionUnit.id, s.student.sectionId))
    .leftJoin(mentor, eq(mentor.id, s.student.mentorUserId))
    .where(where)
    .orderBy(asc(s.student.studentNumber));
}

export type StudentRow = Awaited<ReturnType<typeof studentQuery>>[number];

function guardianQuery(q: Db, where: SQL) {
  return q
    .select({
      studentId: s.guardian.studentId,
      name: s.guardian.name,
      relation: s.guardian.relation,
      phone: s.guardian.phone,
      isPrimary: s.guardian.isPrimary,
    })
    .from(s.guardian)
    .innerJoin(s.student, eq(s.student.id, s.guardian.studentId))
    .where(where)
    .orderBy(desc(s.guardian.isPrimary), asc(s.guardian.name));
}

/** Current-term courses for every section that one of the matching students sits in. */
function sectionCoursesQuery(q: Db, where: SQL) {
  return q
    .select({ sectionId: s.courseOffering.sectionId, code: s.course.code, name: s.course.name })
    .from(s.courseOffering)
    .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
    .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseOffering.termId))
    .where(
      and(
        eq(s.academicTerm.isCurrent, true),
        inArray(
          s.courseOffering.sectionId,
          q.select({ id: s.student.sectionId }).from(s.student).where(where),
        ),
      ),
    )
    .orderBy(asc(s.course.code));
}

/** Credits each regulation requires (the sum over its courses), for the regulations the matching students follow. */
function regulationCreditsQuery(q: Db, where: SQL) {
  return q
    .select({
      curriculumId: s.curriculumCourse.curriculumId,
      credits: sql<number>`sum(${s.course.credits})::int`,
    })
    .from(s.curriculumCourse)
    .innerJoin(s.course, eq(s.course.id, s.curriculumCourse.courseId))
    .where(
      inArray(
        s.curriculumCourse.curriculumId,
        q
          .select({ id: s.batch.curriculumId })
          .from(s.student)
          .innerJoin(s.batch, eq(s.batch.id, s.student.batchId))
          .where(where),
      ),
    )
    .groupBy(s.curriculumCourse.curriculumId);
}

export interface AcademicStanding {
  cgpa: number;
  creditsEarned: number;
  backlogs: number;
  creditsRequired: number;
}

const NO_GUARDIAN: Guardian = { name: "Not recorded", relation: "Guardian", phone: "—" };

/** Pure: record + placement + current term + attendance → domain Student and its subject attendance. */
export function buildStudent(
  row: StudentRow,
  term: CurrentTerm | null,
  courses: readonly { code: string; name: string }[],
  guardian: Guardian | undefined,
  tallies: ReadonlyMap<string, Tally> | undefined,
  institutionThreshold: number,
  academics: AcademicStanding,
): { student: Student; subjects: SubjectAttendance[] } {
  const { year, semester } = placementInTerm(
    row.admissionYear,
    term?.academicYearStart ?? DEMO_NOW.getFullYear(),
    term?.kind ?? "odd",
  );
  // Only fees still come from the synthetic signals (Phase 7); attendance and results are recorded.
  const { feeStatus, feeDue } = syntheticSignals({
    studentNumber: row.studentNumber,
    year,
    semester,
    durationYears: row.durationYears,
    courses,
  });
  const { subjects, attendancePct } = attendanceFields(courses, tallies);
  const attendanceThreshold = row.attendanceThresholdPct ?? institutionThreshold;
  return {
    subjects,
    student: {
      id: row.id,
      studentNumber: row.studentNumber,
      name: row.name,
      gender: row.gender,
      email: row.email,
      phone: row.phone,
      departmentCode: row.departmentCode,
      programme: row.programmeName,
      batch: `${row.admissionYear}–${row.graduationYear}`,
      year,
      semester,
      sectionId: row.sectionCode,
      sectionLabel: row.sectionLabel,
      status: row.status,
      attendancePct,
      attendanceThreshold,
      ...academics,
      feeStatus,
      feeDue,
      risk: evaluateRisk({ attendancePct, attendanceThreshold, ...academics, year }),
      mentorName: row.mentorName ?? "Not assigned",
      hosteller: row.hosteller,
      admittedOn: row.admittedOn,
      guardian: guardian ?? NO_GUARDIAN,
    },
  };
}

export interface StudentBundle {
  term: CurrentTerm | null;
  students: Student[];
  rows: Map<string, StudentRow>;
  subjects: Map<string, SubjectAttendance[]>;
}

async function loadBundle(db: Db, tenantId: string, where: SQL): Promise<StudentBundle> {
  const [terms, rows, guardians, courses, tallyRows, policy, results, regulationCredits] = await withTenant(
    db,
    tenantId,
    (q) => [
      termQuery(q),
      studentQuery(q, where),
      guardianQuery(q, where),
      sectionCoursesQuery(q, where),
      tallyQuery(q, where),
      policyQuery(q),
      standingQuery(q, where),
      regulationCreditsQuery(q, where),
    ],
  );
  const standings = new Map(results.map((r) => [r.studentId, standingFromSums(r)]));
  const required = new Map(regulationCredits.map((r) => [r.curriculumId, r.credits]));
  const term = toTerm(terms);
  const tallies = talliesByStudent(tallyRows);
  const institutionThreshold = policy[0]?.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
  const primary = new Map<string, Guardian>();
  for (const { studentId, name, relation, phone } of guardians)
    if (!primary.has(studentId)) primary.set(studentId, { name, relation, phone });
  const bySection = new Map<string, { code: string; name: string }[]>();
  for (const c of courses) bySection.set(c.sectionId, [...(bySection.get(c.sectionId) ?? []), c]);

  const bundle: StudentBundle = { term, students: [], rows: new Map(), subjects: new Map() };
  for (const row of rows) {
    const built = buildStudent(
      row,
      term,
      bySection.get(row.sectionOrgId) ?? [],
      primary.get(row.id),
      tallies.get(row.id),
      institutionThreshold,
      {
        ...(standings.get(row.id) ?? { cgpa: 0, creditsEarned: 0, backlogs: 0 }),
        creditsRequired: required.get(row.curriculumId) ?? 0,
      },
    );
    bundle.students.push(built.student);
    bundle.rows.set(row.id, row);
    bundle.subjects.set(row.id, built.subjects);
  }
  return bundle;
}

/** Students in the scope prefilter (the engine still decides per row). */
export function loadStudents(db: Db, tenantId: string, scope: StudentScope) {
  return loadBundle(db, tenantId, scopeCondition(scope));
}

export function loadStudentById(db: Db, tenantId: string, id: string) {
  return loadBundle(db, tenantId, eq(s.student.id, id));
}

export async function studentNumberExists(db: Db, tenantId: string, studentNumber: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q.select({ id: s.student.id }).from(s.student).where(eq(s.student.studentNumber, studentNumber)),
  ]);
  return rows.length > 0;
}

export interface Placement {
  programmeCode: string;
  regulationCode: string;
  regulationName: string;
  batchCode: string;
  batchName: string;
  termName: string | null;
  courses: {
    offeringId: string;
    code: string;
    name: string;
    credits: number;
    type: "theory" | "lab" | "project";
    faculty: string[];
  }[];
  history: { id: string; sectionLabel: string; startedOn: string; endedOn: string | null; reason: string }[];
  guardians: (Guardian & { isPrimary: boolean })[];
}

/** Student 360's academic placement: regulation, batch, this term's courses and who teaches them, history. */
export async function loadPlacement(db: Db, tenantId: string, row: StudentRow): Promise<Placement> {
  const historySection = aliasedTable(s.section, "history_section");
  const [terms, courses, history, guardians] = await withTenant(db, tenantId, (q) => [
    termQuery(q),
    q
      .select({
        offeringId: s.courseOffering.id,
        code: s.course.code,
        name: s.course.name,
        credits: s.course.credits,
        type: s.course.type,
        faculty: s.appUser.name,
      })
      .from(s.courseOffering)
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseOffering.termId))
      .leftJoin(
        s.teachingAllocation,
        and(eq(s.teachingAllocation.offeringId, s.courseOffering.id), isNull(s.teachingAllocation.removedAt)),
      )
      .leftJoin(s.appUser, eq(s.appUser.id, s.teachingAllocation.userId))
      .where(and(eq(s.academicTerm.isCurrent, true), eq(s.courseOffering.sectionId, row.sectionOrgId)))
      .orderBy(asc(s.course.code)),
    q
      .select({
        id: s.studentSectionHistory.id,
        sectionLabel: historySection.label,
        startedOn: s.studentSectionHistory.startedOn,
        endedOn: s.studentSectionHistory.endedOn,
        reason: s.studentSectionHistory.reason,
      })
      .from(s.studentSectionHistory)
      .innerJoin(historySection, eq(historySection.orgUnitId, s.studentSectionHistory.sectionId))
      .where(eq(s.studentSectionHistory.studentId, row.id))
      .orderBy(desc(s.studentSectionHistory.startedOn), desc(s.studentSectionHistory.recordedAt)),
    guardianQuery(q, eq(s.student.id, row.id)),
  ]);
  const byOffering = new Map<string, Placement["courses"][number]>();
  for (const c of courses) {
    const entry = byOffering.get(c.offeringId) ?? { ...c, faculty: [] };
    if (c.faculty) entry.faculty.push(c.faculty);
    byOffering.set(c.offeringId, entry);
  }
  return {
    programmeCode: row.programmeCode,
    regulationCode: row.regulationCode,
    regulationName: row.regulationName,
    batchCode: row.batchCode,
    batchName: row.batchName,
    termName: toTerm(terms)?.name ?? null,
    courses: [...byOffering.values()],
    history,
    guardians: guardians.map(({ name, relation, phone, isPrimary }) => ({
      name,
      relation,
      phone,
      isPrimary,
    })),
  };
}
