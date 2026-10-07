import { aliasedTable, and, asc, count, eq, isNull, sql, sum } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";

/*
 * Academic structure loaders. Next-agnostic and always under RLS (withTenant). Authorization of who may see
 * what is applied by the repository on top of these.
 */

type Db = NeonHttpDatabase<typeof s>;

const ownerUnit = aliasedTable(s.orgUnit, "owner_unit");
const departmentUnit = aliasedTable(s.orgUnit, "department_unit");
const sectionUnit = aliasedTable(s.orgUnit, "section_unit");

const weeklyHours = sql<number>`${s.course.lectureHours} + ${s.course.tutorialHours} + ${s.course.practicalHours}`;

export async function loadTerms(db: Db, tenantId: string) {
  const [terms, offeringCounts] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.academicTerm.id,
        code: s.academicTerm.code,
        name: s.academicTerm.name,
        kind: s.academicTerm.kind,
        startsOn: s.academicTerm.startsOn,
        endsOn: s.academicTerm.endsOn,
        isCurrent: s.academicTerm.isCurrent,
        academicYearCode: s.academicYear.code,
        academicYearStartsOn: s.academicYear.startsOn,
      })
      .from(s.academicTerm)
      .innerJoin(s.academicYear, eq(s.academicYear.id, s.academicTerm.academicYearId))
      .orderBy(asc(s.academicTerm.startsOn)),
    q
      .select({ termId: s.courseOffering.termId, offerings: count() })
      .from(s.courseOffering)
      .groupBy(s.courseOffering.termId),
  ]);
  const counts = new Map(offeringCounts.map((c) => [c.termId, c.offerings]));
  return terms.map((t) => ({
    ...t,
    academicYearStart: Number(t.academicYearStartsOn.slice(0, 4)),
    offerings: counts.get(t.id) ?? 0,
  }));
}
export type TermRow = Awaited<ReturnType<typeof loadTerms>>[number];

function regulationQuery(q: Db) {
  return q
    .select({
      id: s.curriculum.id,
      programmeId: s.curriculum.programmeId,
      code: s.curriculum.code,
      name: s.curriculum.name,
      status: s.curriculum.status,
      effectiveFromYear: s.curriculum.effectiveFromYear,
      derivedFromId: s.curriculum.derivedFromId,
      publishedAt: s.curriculum.publishedAt,
      courses: count(s.curriculumCourse.courseId),
      credits: sql<number>`coalesce(${sum(s.course.credits)}, 0)::int`,
    })
    .from(s.curriculum)
    .leftJoin(s.curriculumCourse, eq(s.curriculumCourse.curriculumId, s.curriculum.id))
    .leftJoin(s.course, eq(s.course.id, s.curriculumCourse.courseId))
    .groupBy(s.curriculum.id)
    .orderBy(asc(s.curriculum.code));
}

function batchQuery(q: Db) {
  return q
    .select({
      id: s.batch.id,
      programmeId: s.batch.programmeId,
      curriculumId: s.batch.curriculumId,
      code: s.batch.code,
      name: s.batch.name,
      admissionYear: s.batch.admissionYear,
      graduationYear: s.batch.graduationYear,
    })
    .from(s.batch)
    .orderBy(asc(s.batch.admissionYear));
}

function sectionQuery(q: Db) {
  return q
    .select({
      id: s.section.orgUnitId,
      batchId: s.section.batchId,
      code: sectionUnit.code,
      label: s.section.label,
      letter: s.section.letter,
      students: sql<number>`(select count(*)::int from ${s.student} where ${s.student.sectionId} = ${s.section.orgUnitId})`,
    })
    .from(s.section)
    .innerJoin(sectionUnit, eq(sectionUnit.id, s.section.orgUnitId))
    .orderBy(asc(sectionUnit.code));
}

/** Programmes with their regulations, batches and sections. */
export async function loadProgrammes(db: Db, tenantId: string) {
  const [programmes, regulations, batches, sections] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.programme.id,
        code: s.programme.code,
        name: s.programme.name,
        level: s.programme.level,
        durationYears: s.programme.durationYears,
        semesters: s.programme.semesters,
        attendanceThresholdPct: s.programme.attendanceThresholdPct,
        departmentId: s.programme.departmentId,
        departmentCode: departmentUnit.code,
        departmentName: departmentUnit.name,
      })
      .from(s.programme)
      .innerJoin(departmentUnit, eq(departmentUnit.id, s.programme.departmentId))
      .orderBy(asc(s.programme.code)),
    regulationQuery(q),
    batchQuery(q),
    sectionQuery(q),
  ]);
  return programmes.map((p) => {
    const progBatches = batches
      .filter((b) => b.programmeId === p.id)
      .map((b) => {
        const secs = sections.filter((x) => x.batchId === b.id);
        return {
          ...b,
          regulationCode: regulations.find((r) => r.id === b.curriculumId)?.code ?? "—",
          sections: secs,
          students: secs.reduce((n, x) => n + x.students, 0),
        };
      });
    return {
      ...p,
      regulations: regulations
        .filter((r) => r.programmeId === p.id)
        .map((r) => ({ ...r, batches: progBatches.filter((b) => b.curriculumId === r.id).length })),
      batches: progBatches,
      students: progBatches.reduce((n, b) => n + b.students, 0),
    };
  });
}
export type ProgrammeRow = Awaited<ReturnType<typeof loadProgrammes>>[number];

/** Semester-wise course lists for one programme's regulations. */
export async function loadRegulationCourses(db: Db, tenantId: string, programmeId: string) {
  const [rows] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        curriculumId: s.curriculumCourse.curriculumId,
        semester: s.curriculumCourse.semester,
        category: s.curriculumCourse.category,
        courseId: s.course.id,
        code: s.course.code,
        name: s.course.name,
        type: s.course.type,
        credits: s.course.credits,
        lectureHours: s.course.lectureHours,
        tutorialHours: s.course.tutorialHours,
        practicalHours: s.course.practicalHours,
      })
      .from(s.curriculumCourse)
      .innerJoin(s.curriculum, eq(s.curriculum.id, s.curriculumCourse.curriculumId))
      .innerJoin(s.course, eq(s.course.id, s.curriculumCourse.courseId))
      .where(eq(s.curriculum.programmeId, programmeId))
      .orderBy(asc(s.curriculumCourse.semester), asc(s.course.code)),
  ]);
  return rows;
}
export type RegulationCourseRow = Awaited<ReturnType<typeof loadRegulationCourses>>[number];

/** The course catalogue with owner, and where each course is used. */
export async function loadCourses(db: Db, tenantId: string) {
  const [courses, usage, offered] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.course.id,
        code: s.course.code,
        name: s.course.name,
        type: s.course.type,
        credits: s.course.credits,
        lectureHours: s.course.lectureHours,
        tutorialHours: s.course.tutorialHours,
        practicalHours: s.course.practicalHours,
        ownerUnitId: s.course.ownerUnitId,
        ownerCode: ownerUnit.code,
        ownerName: ownerUnit.name,
      })
      .from(s.course)
      .innerJoin(ownerUnit, eq(ownerUnit.id, s.course.ownerUnitId))
      .orderBy(asc(s.course.code)),
    q
      .select({ courseId: s.curriculumCourse.courseId, regulations: count() })
      .from(s.curriculumCourse)
      .groupBy(s.curriculumCourse.courseId),
    q
      .select({ courseId: s.courseOffering.courseId, sections: count() })
      .from(s.courseOffering)
      .innerJoin(s.academicTerm, eq(s.academicTerm.id, s.courseOffering.termId))
      .where(eq(s.academicTerm.isCurrent, true))
      .groupBy(s.courseOffering.courseId),
  ]);
  const used = new Map(usage.map((u) => [u.courseId, u.regulations]));
  const current = new Map(offered.map((o) => [o.courseId, o.sections]));
  return courses.map((c) => ({
    ...c,
    regulations: used.get(c.id) ?? 0,
    sectionsThisTerm: current.get(c.id) ?? 0,
  }));
}
export type CourseRow = Awaited<ReturnType<typeof loadCourses>>[number];

/** Offerings in a term with course, section and current allocations. */
export async function loadOfferings(db: Db, tenantId: string, termId: string) {
  const [offerings, allocations] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.courseOffering.id,
        status: s.courseOffering.status,
        sectionId: s.courseOffering.sectionId,
        sectionCode: sectionUnit.code,
        sectionLabel: s.section.label,
        sectionParentId: sectionUnit.parentId,
        batchCode: s.batch.code,
        courseId: s.course.id,
        courseCode: s.course.code,
        courseName: s.course.name,
        courseType: s.course.type,
        credits: s.course.credits,
        weeklyHours,
      })
      .from(s.courseOffering)
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.section, eq(s.section.orgUnitId, s.courseOffering.sectionId))
      .innerJoin(sectionUnit, eq(sectionUnit.id, s.courseOffering.sectionId))
      .innerJoin(s.batch, eq(s.batch.id, s.section.batchId))
      .where(eq(s.courseOffering.termId, termId))
      .orderBy(asc(sectionUnit.code), asc(s.course.code)),
    q
      .select({
        id: s.teachingAllocation.id,
        offeringId: s.teachingAllocation.offeringId,
        userId: s.teachingAllocation.userId,
        name: s.appUser.name,
        role: s.teachingAllocation.role,
        allocatedAt: s.teachingAllocation.allocatedAt,
      })
      .from(s.teachingAllocation)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.teachingAllocation.offeringId))
      .innerJoin(s.appUser, eq(s.appUser.id, s.teachingAllocation.userId))
      .where(and(eq(s.courseOffering.termId, termId), isNull(s.teachingAllocation.removedAt)))
      .orderBy(asc(s.teachingAllocation.allocatedAt)),
  ]);
  return offerings.map((o) => ({ ...o, allocations: allocations.filter((a) => a.offeringId === o.id) }));
}
export type OfferingRow = Awaited<ReturnType<typeof loadOfferings>>[number];

/** Faculty profiles and their allocations in a term. */
export async function loadFaculty(db: Db, tenantId: string, termId: string | null) {
  const [profiles, allocations] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        userId: s.facultyProfile.userId,
        name: s.appUser.name,
        email: s.appUser.email,
        employeeCode: s.facultyProfile.employeeCode,
        designation: s.facultyProfile.designation,
        status: s.facultyProfile.status,
        maxWeeklyHours: s.facultyProfile.maxWeeklyHours,
        joinedOn: s.facultyProfile.joinedOn,
        departmentId: s.facultyProfile.departmentId,
        departmentCode: departmentUnit.code,
        departmentName: departmentUnit.name,
      })
      .from(s.facultyProfile)
      .innerJoin(s.appUser, eq(s.appUser.id, s.facultyProfile.userId))
      .innerJoin(departmentUnit, eq(departmentUnit.id, s.facultyProfile.departmentId))
      .orderBy(asc(departmentUnit.code), asc(s.appUser.name)),
    q
      .select({
        id: s.teachingAllocation.id,
        userId: s.teachingAllocation.userId,
        role: s.teachingAllocation.role,
        offeringId: s.courseOffering.id,
        courseCode: s.course.code,
        courseName: s.course.name,
        credits: s.course.credits,
        weeklyHours,
        sectionId: s.courseOffering.sectionId,
        sectionLabel: s.section.label,
      })
      .from(s.teachingAllocation)
      .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.teachingAllocation.offeringId))
      .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
      .innerJoin(s.section, eq(s.section.orgUnitId, s.courseOffering.sectionId))
      .where(
        and(
          isNull(s.teachingAllocation.removedAt),
          termId ? eq(s.courseOffering.termId, termId) : sql`false`,
        ),
      )
      .orderBy(asc(s.course.code), asc(s.section.label)),
  ]);
  return profiles.map((p) => {
    const teaching = allocations.filter((a) => a.userId === p.userId);
    return { ...p, teaching, hours: teaching.reduce((n, a) => n + a.weeklyHours, 0) };
  });
}
export type FacultyRow = Awaited<ReturnType<typeof loadFaculty>>[number];

/** Inputs for generating a term's offerings from each section's regulation. */
export async function loadOfferingPlanInputs(db: Db, tenantId: string, termId: string) {
  const [sections, courses, existing] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        sectionId: s.section.orgUnitId,
        admissionYear: s.batch.admissionYear,
        curriculumId: s.batch.curriculumId,
        semesters: s.programme.semesters,
      })
      .from(s.section)
      .innerJoin(s.batch, eq(s.batch.id, s.section.batchId))
      .innerJoin(s.programme, eq(s.programme.id, s.batch.programmeId)),
    q
      .select({
        curriculumId: s.curriculumCourse.curriculumId,
        courseId: s.curriculumCourse.courseId,
        semester: s.curriculumCourse.semester,
      })
      .from(s.curriculumCourse),
    q
      .select({ courseId: s.courseOffering.courseId, sectionId: s.courseOffering.sectionId })
      .from(s.courseOffering)
      .where(eq(s.courseOffering.termId, termId)),
  ]);
  return { sections, courses, existing };
}

/** A role's permission set for this tenant (role tables are access data, outside RLS). */
export async function loadRolePermissions(db: Db, tenantId: string, roleKey: string): Promise<Set<string>> {
  const rows = await db
    .select({ permission: s.rolePermission.permissionKey })
    .from(s.role)
    .innerJoin(s.rolePermission, eq(s.rolePermission.roleId, s.role.id))
    .where(and(eq(s.role.tenantId, tenantId), eq(s.role.key, roleKey)));
  return new Set(rows.map((r) => r.permission));
}
