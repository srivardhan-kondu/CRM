import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "../src/db/schema";
import {
  ACADEMIC_YEAR,
  BATCHES,
  batchForSection,
  COURSE_CATALOGUE,
  currentTermOfferings,
  FACULTY,
  PROGRAMMES,
  REGULATIONS,
  TERMS,
} from "../src/lib/demo/academics";
import { FACULTY_BY_DEPT, SECTIONS, STUDENTS } from "../src/lib/demo/fixtures";

/*
 * Phase 2 seed: academic structure, faculty, students and current-term teaching for the demo tenant. Runs as the
 * owner (outside RLS). Idempotent, and deliberately conservative on re-runs: records that the app may since have
 * changed — students, published regulations, allocations — are created once and never overwritten.
 */

type Db = NeonHttpDatabase<typeof s>;

function chunks<T>(rows: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

async function unitIds(db: Db, tenantId: string) {
  const rows = await db
    .select({ id: s.orgUnit.id, code: s.orgUnit.code })
    .from(s.orgUnit)
    .where(eq(s.orgUnit.tenantId, tenantId));
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Academic year and terms. The other tenant gets a year and current term only, so its context renders. */
export async function seedCalendar(db: Db, tenantId: string, terms = TERMS) {
  await db
    .insert(s.academicYear)
    .values({ tenantId, ...ACADEMIC_YEAR, isCurrent: true })
    .onConflictDoNothing();
  const [year] = await db
    .select({ id: s.academicYear.id })
    .from(s.academicYear)
    .where(and(eq(s.academicYear.tenantId, tenantId), eq(s.academicYear.code, ACADEMIC_YEAR.code)));
  // Which term is current is an operational decision made in the app; the seed only sets it on first creation.
  const [anyCurrent] = await db
    .select({ id: s.academicTerm.id })
    .from(s.academicTerm)
    .where(and(eq(s.academicTerm.tenantId, tenantId), eq(s.academicTerm.isCurrent, true)));
  await db
    .insert(s.academicTerm)
    .values(
      terms.map((t) => ({
        tenantId,
        academicYearId: year!.id,
        ...t,
        isCurrent: anyCurrent ? false : t.isCurrent,
      })),
    )
    .onConflictDoNothing();
}

export async function seedAcademics(db: Db, tenantId: string, log: (m: string) => void) {
  const units = await unitIds(db, tenantId);
  const unit = (code: string) => {
    const id = units.get(code);
    if (!id) throw new Error(`Seed: unknown org unit ${code}`);
    return id;
  };

  // Programmes
  await db
    .insert(s.programme)
    .values(
      PROGRAMMES.map((p) => ({
        tenantId,
        departmentId: unit(p.departmentCode),
        code: p.code,
        name: p.name,
        level: p.level,
        durationYears: p.durationYears,
        semesters: p.semesters,
      })),
    )
    .onConflictDoUpdate({
      target: [s.programme.tenantId, s.programme.code],
      set: { name: sql`excluded.name` },
    });
  const programmes = new Map(
    (
      await db
        .select({ id: s.programme.id, code: s.programme.code })
        .from(s.programme)
        .where(eq(s.programme.tenantId, tenantId))
    ).map((r) => [r.code, r.id]),
  );

  // Course catalogue
  for (const part of chunks(COURSE_CATALOGUE)) {
    await db
      .insert(s.course)
      .values(part.map(({ ownerCode, ...c }) => ({ tenantId, ownerUnitId: unit(ownerCode), ...c })))
      .onConflictDoNothing();
  }
  const courses = new Map(
    (
      await db
        .select({ id: s.course.id, code: s.course.code, name: s.course.name })
        .from(s.course)
        .where(eq(s.course.tenantId, tenantId))
    ).map((r) => [r.code, r]),
  );

  // Regulations: created as drafts, filled, then published. Existing ones are left alone (their course lists are
  // frozen once published, and drafts belong to whoever is revising them).
  const existingRegs = await db
    .select({ id: s.curriculum.id, programmeId: s.curriculum.programmeId, code: s.curriculum.code })
    .from(s.curriculum)
    .where(eq(s.curriculum.tenantId, tenantId));
  const regId = (programmeCode: string, code: string) =>
    existingRegs.find((r) => r.programmeId === programmes.get(programmeCode) && r.code === code)?.id;
  for (const reg of REGULATIONS) {
    if (regId(reg.programmeCode, reg.code)) continue;
    const programmeId = programmes.get(reg.programmeCode)!;
    const id = crypto.randomUUID();
    const derivedFromId = reg.derivedFrom ? (regId(reg.programmeCode, reg.derivedFrom) ?? null) : null;
    const fill = [
      db.insert(s.curriculum).values({
        id,
        tenantId,
        programmeId,
        code: reg.code,
        name: reg.name,
        status: "draft",
        effectiveFromYear: reg.effectiveFromYear,
        derivedFromId,
      }),
      db.insert(s.curriculumCourse).values(
        reg.courses.map((c) => ({
          tenantId,
          curriculumId: id,
          courseId: courses.get(c.code)!.id,
          semester: c.semester,
          category: c.category,
        })),
      ),
    ] as const;
    if (reg.status === "draft") await db.batch(fill);
    else
      await db.batch([
        ...fill,
        db
          .update(s.curriculum)
          .set({ status: reg.status, publishedAt: new Date("2024-05-01T00:00:00Z") })
          .where(eq(s.curriculum.id, id)),
      ]);
    existingRegs.push({ id, programmeId, code: reg.code });
  }

  // Batches and sections
  await db
    .insert(s.batch)
    .values(
      BATCHES.map((b) => ({
        tenantId,
        programmeId: programmes.get(b.programmeCode)!,
        curriculumId: regId(b.programmeCode, b.regulationCode)!,
        code: b.code,
        name: b.name,
        admissionYear: b.admissionYear,
        graduationYear: b.graduationYear,
      })),
    )
    .onConflictDoNothing();
  const batches = new Map(
    (
      await db
        .select({ id: s.batch.id, code: s.batch.code })
        .from(s.batch)
        .where(eq(s.batch.tenantId, tenantId))
    ).map((r) => [r.code, r.id]),
  );
  await db
    .insert(s.section)
    .values(
      SECTIONS.map((sec) => ({
        orgUnitId: unit(sec.id),
        tenantId,
        batchId: batches.get(batchForSection(sec.id).code)!,
        letter: sec.letter,
        label: sec.label,
      })),
    )
    .onConflictDoNothing();
  log(
    `academic structure: ${PROGRAMMES.length} programmes, ${REGULATIONS.length} regulations, ${COURSE_CATALOGUE.length} courses, ${BATCHES.length} batches`,
  );

  // Faculty: users, memberships and profiles. Persona faculty share their persona account.
  for (const part of chunks(FACULTY)) {
    await db
      .insert(s.appUser)
      .values(part.map((f) => ({ name: f.name, email: f.email, emailVerified: true })))
      .onConflictDoNothing({ target: s.appUser.email });
  }
  const users = new Map(
    (
      await db
        .select({ id: s.appUser.id, email: s.appUser.email })
        .from(s.appUser)
        .where(
          inArray(
            s.appUser.email,
            FACULTY.map((f) => f.email),
          ),
        )
    ).map((r) => [r.email, r.id]),
  );
  const facultyUser = (name: string) => users.get(FACULTY.find((f) => f.name === name)!.email)!;
  await db
    .insert(s.tenantMembership)
    .values(FACULTY.map((f) => ({ tenantId, userId: users.get(f.email)! })))
    .onConflictDoNothing();
  await db
    .insert(s.facultyProfile)
    .values(
      FACULTY.map((f) => ({
        tenantId,
        userId: users.get(f.email)!,
        employeeCode: f.employeeCode,
        designation: f.designation,
        departmentId: unit(f.departmentCode),
        maxWeeklyHours: f.maxWeeklyHours,
        joinedOn: f.joinedOn,
      })),
    )
    .onConflictDoNothing();
  log(`${FACULTY.length} faculty`);

  // Students, guardians and their admission placement. Created once; later edits in the app are kept.
  const sectionCode = new Map(SECTIONS.map((sec) => [sec.id, sec]));
  let created = 0;
  for (const part of chunks([...STUDENTS])) {
    const inserted = await db
      .insert(s.student)
      .values(
        part.map((st) => {
          const sec = sectionCode.get(st.sectionId)!;
          const b = batchForSection(sec.id);
          const mentor = FACULTY_BY_DEPT[st.departmentCode]?.includes(st.mentorName)
            ? facultyUser(st.mentorName)
            : null;
          return {
            id: st.id,
            tenantId,
            studentNumber: st.studentNumber,
            name: st.name,
            gender: st.gender,
            email: st.email,
            phone: st.phone,
            programmeId: programmes.get(b.programmeCode)!,
            batchId: batches.get(b.code)!,
            sectionId: unit(st.sectionId),
            status: st.status,
            admittedOn: st.admittedOn,
            hosteller: st.hosteller,
            mentorUserId: mentor,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: s.student.id });
    const fresh = new Set(inserted.map((r) => r.id));
    const freshStudents = part.filter((st) => fresh.has(st.id));
    if (freshStudents.length === 0) continue;
    created += freshStudents.length;
    await db.batch([
      db.insert(s.guardian).values(
        freshStudents.map((st) => ({
          tenantId,
          studentId: st.id,
          name: st.guardian.name,
          relation: st.guardian.relation,
          phone: st.guardian.phone,
          isPrimary: true,
        })),
      ),
      db.insert(s.studentSectionHistory).values(
        freshStudents.map((st) => ({
          tenantId,
          studentId: st.id,
          sectionId: unit(st.sectionId),
          startedOn: st.admittedOn,
          reason: "Admission",
        })),
      ),
    ]);
  }
  log(`students: ${created} created, ${STUDENTS.length - created} already present`);

  // Current-term offerings and allocations. An offering that has ever had an allocation is left alone, so a
  // re-seed never resurrects a removal made in the app.
  const [term] = await db
    .select({ id: s.academicTerm.id, code: s.academicTerm.code })
    .from(s.academicTerm)
    .where(
      and(
        eq(s.academicTerm.tenantId, tenantId),
        eq(s.academicTerm.code, TERMS.find((t) => t.isCurrent)!.code),
      ),
    );
  const plan = currentTermOfferings();
  for (const part of chunks(plan)) {
    await db
      .insert(s.courseOffering)
      .values(
        part.map((o) => ({
          tenantId,
          termId: term!.id,
          courseId: courses.get(o.courseCode)!.id,
          sectionId: unit(o.sectionCode),
          status: "active" as const,
        })),
      )
      .onConflictDoNothing();
  }
  const offerings = await db
    .select({
      id: s.courseOffering.id,
      courseId: s.courseOffering.courseId,
      sectionId: s.courseOffering.sectionId,
    })
    .from(s.courseOffering)
    .where(eq(s.courseOffering.termId, term!.id));
  const everAllocated = new Set(
    (
      await db
        .select({ offeringId: s.teachingAllocation.offeringId })
        .from(s.teachingAllocation)
        .where(eq(s.teachingAllocation.tenantId, tenantId))
    ).map((r) => r.offeringId),
  );
  const allocations = plan
    .filter((o) => o.facultyName)
    .map((o) => {
      const offering = offerings.find(
        (x) => x.courseId === courses.get(o.courseCode)!.id && x.sectionId === unit(o.sectionCode),
      )!;
      return {
        tenantId,
        offeringId: offering.id,
        userId: facultyUser(o.facultyName!),
        role: "primary" as const,
      };
    })
    .filter((a) => !everAllocated.has(a.offeringId));
  for (const part of chunks(allocations)) await db.insert(s.teachingAllocation).values(part);
  log(`${plan.length} offerings for ${term!.code}, ${allocations.length} new allocations`);
}

/** Phase 1 granted persona faculty access directly; allocations now provide it, so those grants are revoked. */
export async function revokeSupersededFacultyGrants(
  db: Db,
  tenantId: string,
  userIds: string[],
  reason: string,
) {
  if (userIds.length === 0) return;
  const [facultyRole] = await db
    .select({ id: s.role.id })
    .from(s.role)
    .where(and(eq(s.role.tenantId, tenantId), eq(s.role.key, "faculty")));
  if (!facultyRole) return;
  await db
    .update(s.roleAssignment)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(
      and(
        eq(s.roleAssignment.tenantId, tenantId),
        eq(s.roleAssignment.roleId, facultyRole.id),
        inArray(s.roleAssignment.userId, userIds),
        isNull(s.roleAssignment.revokedAt),
      ),
    );
}
