import { and, eq, inArray } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "../src/db/schema";
import { cieComponents, eligibilityFor, seeMax, type CourseType } from "../src/domains/exams/rules";
import { COURSE_CATALOGUE, currentTermOfferings, FACULTY, TERMS } from "../src/lib/demo/academics";
import { studentIdFor } from "../src/lib/demo/base";
import { STUDENTS } from "../src/lib/demo/fixtures";
import {
  componentState,
  condonationRequests,
  currentCieMarks,
  PAST_RESULTS,
  PAST_TERMS,
  REGULAR_EVENT,
  regularSchedule,
  STUDENT_SPECS,
  SUPPLEMENTARY,
  SUPPLEMENTARY_REGISTRATIONS,
} from "../src/lib/demo/results";

/*
 * Phase 4 seed: past terms and their published results, the September supplementary examinations (marks entered, not
 * published), the November regular examinations (timetable, registrations), the current term's internal assessment and
 * condonation requests (lib/demo/results.ts). Runs as the owner; written once — if the tenant has any examination,
 * nothing here is rewritten.
 */

type Db = NeonHttpDatabase<typeof s>;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const at = (date: string, time = "10:00") => new Date(`${date}T${time}:00+05:30`);
const typeOf = new Map(COURSE_CATALOGUE.map((c) => [c.code, c.type as CourseType]));

/** Past academic years and terms (the current year's are written by seedCalendar). */
export async function seedPastTerms(db: Db, tenantId: string) {
  const years = [...new Map(PAST_TERMS.map((t) => [t.academicYear.code, t.academicYear])).values()];
  await db
    .insert(s.academicYear)
    .values(years.map((y) => ({ tenantId, ...y, isCurrent: false })))
    .onConflictDoNothing();
  const yearIds = new Map(
    (
      await db
        .select({ id: s.academicYear.id, code: s.academicYear.code })
        .from(s.academicYear)
        .where(eq(s.academicYear.tenantId, tenantId))
    ).map((y) => [y.code, y.id]),
  );
  await db
    .insert(s.academicTerm)
    .values(
      PAST_TERMS.map((t) => ({
        tenantId,
        academicYearId: yearIds.get(t.academicYear.code)!,
        code: t.code,
        name: t.name,
        kind: t.kind,
        startsOn: t.startsOn,
        endsOn: t.endsOn,
        isCurrent: false,
      })),
    )
    .onConflictDoNothing();
}

export async function seedExams(
  db: Db,
  tenantId: string,
  personaIds: ReadonlyMap<string, string>,
  log: (m: string) => void,
) {
  await seedPastTerms(db, tenantId);
  const [existing] = await db
    .select({ id: s.examEvent.id })
    .from(s.examEvent)
    .where(eq(s.examEvent.tenantId, tenantId))
    .limit(1);
  if (existing) {
    log("exams: history already present, left unchanged");
    return;
  }

  const terms = new Map(
    (
      await db
        .select({ id: s.academicTerm.id, code: s.academicTerm.code })
        .from(s.academicTerm)
        .where(eq(s.academicTerm.tenantId, tenantId))
    ).map((t) => [t.code, t.id]),
  );
  const courses = new Map(
    (
      await db
        .select({ id: s.course.id, code: s.course.code })
        .from(s.course)
        .where(eq(s.course.tenantId, tenantId))
    ).map((c) => [c.code, c.id]),
  );
  const catalogue = new Map(COURSE_CATALOGUE.map((c) => [c.code, c]));
  const coe = personaIds.get("exam_controller")!;
  const currentTerm = TERMS.find((t) => t.isCurrent)!;

  // Events: one regular per past term (published), the September supplementary, the November regular.
  const eventRows = [
    ...PAST_TERMS.map((t) => ({
      tenantId,
      code: `REG-${t.code}`,
      name: `Semester-end examinations, ${t.name}`,
      kind: "regular" as const,
      termId: terms.get(t.code)!,
      startsOn: t.kind === "odd" ? `${t.startsOn.slice(0, 4)}-11-16` : `${t.endsOn.slice(0, 4)}-04-27`,
      endsOn: t.kind === "odd" ? `${t.startsOn.slice(0, 4)}-11-28` : `${t.endsOn.slice(0, 4)}-05-09`,
      status: "published" as const,
      publishedAt: new Date(t.publishedAt),
      publishedBy: coe,
    })),
    {
      tenantId,
      code: SUPPLEMENTARY.code,
      name: SUPPLEMENTARY.name,
      kind: "supplementary" as const,
      termId: null,
      startsOn: SUPPLEMENTARY.startsOn,
      endsOn: SUPPLEMENTARY.endsOn,
    },
    {
      tenantId,
      code: REGULAR_EVENT.code,
      name: REGULAR_EVENT.name,
      kind: "regular" as const,
      termId: terms.get(currentTerm.code)!,
      startsOn: REGULAR_EVENT.startsOn,
      endsOn: REGULAR_EVENT.endsOn,
    },
  ];
  const events = new Map(
    (
      await db.insert(s.examEvent).values(eventRows).returning({ id: s.examEvent.id, code: s.examEvent.code })
    ).map((e) => [e.code, e.id]),
  );

  // Past results.
  for (const part of chunks(PAST_RESULTS, 1000))
    await db.insert(s.courseResult).values(
      part.map((r) => {
        const type = typeOf.get(r.courseCode)!;
        return {
          tenantId,
          studentId: studentIdFor(r.studentNumber),
          courseId: courses.get(r.courseCode)!,
          termId: terms.get(r.termCode)!,
          eventId: events.get(r.eventCode)!,
          semester: r.semester,
          attempt: r.attempt,
          credits: r.credits,
          cie: r.cie,
          cieMax: cieComponents(type).reduce((n, c) => n + c.maxMarks, 0),
          see: r.see,
          seeMax: seeMax(type),
          total: r.total,
          grade: r.grade,
          gradePoint: r.gradePoint,
          outcome: r.outcome,
          publishedAt: new Date(r.publishedAt),
        };
      }),
    );

  // September supplementary: timetable by semester position, registrations with internal marks carried over.
  const suppEvent = events.get(SUPPLEMENTARY.code)!;
  const suppCourses = [...new Set(SUPPLEMENTARY_REGISTRATIONS.map((r) => r.courseCode))].sort();
  const suppDays = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"];
  await db.insert(s.examSchedule).values(
    suppCourses.map((code, i) => ({
      tenantId,
      eventId: suppEvent,
      courseId: courses.get(code)!,
      date: suppDays[i % suppDays.length]!,
      session: (Math.floor(i / suppDays.length) % 2 === 0 ? "FN" : "AN") as "FN" | "AN",
    })),
  );
  for (const part of chunks(SUPPLEMENTARY_REGISTRATIONS, 1000))
    await db.insert(s.examRegistration).values(
      part.map((r) => ({
        tenantId,
        eventId: suppEvent,
        studentId: studentIdFor(r.studentNumber),
        courseId: courses.get(r.courseCode)!,
        termId: terms.get(r.termCode)!,
        semester: r.semester,
        cieCarried: r.cie,
        seeMax: seeMax(typeOf.get(r.courseCode)!),
        seeMarks: r.see,
        seeAbsent: r.seeAbsent,
        enteredBy: r.see !== null || r.seeAbsent ? coe : null,
        enteredAt: r.see !== null || r.seeAbsent ? at("2026-09-28") : null,
      })),
    );

  // November regular: timetable and a registration per student per current course.
  const regEvent = events.get(REGULAR_EVENT.code)!;
  await db.insert(s.examSchedule).values(
    regularSchedule().map((x) => ({
      tenantId,
      eventId: regEvent,
      courseId: courses.get(x.courseCode)!,
      date: x.date,
      session: x.session,
    })),
  );
  const offerings = currentTermOfferings();
  const registrations = STUDENT_SPECS.flatMap((st) =>
    offerings
      .filter((o) => o.sectionCode === st.sectionCode)
      .map((o) => ({
        tenantId,
        eventId: regEvent,
        studentId: studentIdFor(st.studentNumber),
        courseId: courses.get(o.courseCode)!,
        termId: terms.get(currentTerm.code)!,
        semester: st.semester,
        seeMax: seeMax(typeOf.get(o.courseCode)!),
      })),
  );
  for (const part of chunks(registrations, 1000)) await db.insert(s.examRegistration).values(part);

  // Current term internal assessment: components per offering, IA-1 moderated almost everywhere.
  const offeringRows = await db
    .select({ id: s.courseOffering.id, sectionCode: s.orgUnit.code, courseCode: s.course.code })
    .from(s.courseOffering)
    .innerJoin(s.course, eq(s.course.id, s.courseOffering.courseId))
    .innerJoin(s.orgUnit, eq(s.orgUnit.id, s.courseOffering.sectionId))
    .where(
      and(eq(s.courseOffering.tenantId, tenantId), eq(s.courseOffering.termId, terms.get(currentTerm.code)!)),
    );
  const facultyIds = new Map(
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
    ).map((u) => [FACULTY.find((f) => f.email === u.email)!.name, u.id]),
  );
  const teacher = new Map(offerings.map((o) => [`${o.sectionCode}/${o.courseCode}`, o.facultyName]));
  const hod = personaIds.get("hod_cse")!;
  const principal = personaIds.get("principal")!;
  const componentRows = offeringRows.flatMap((o) =>
    cieComponents(catalogue.get(o.courseCode)!.type as CourseType).map((c, position) => {
      const state = componentState(o.sectionCode, o.courseCode, c.key);
      const by = teacher.get(`${o.sectionCode}/${o.courseCode}`);
      const submittedBy = state !== "open" && by ? (facultyIds.get(by) ?? null) : null;
      return {
        tenantId,
        offeringId: o.id,
        key: c.key,
        label: c.label,
        maxMarks: c.maxMarks,
        position,
        status: submittedBy ? state : ("open" as const),
        submittedBy,
        submittedAt: submittedBy ? at("2026-09-19", "16:00") : null,
        decidedBy:
          submittedBy && state === "approved" ? (o.sectionCode.startsWith("CSE-") ? hod : principal) : null,
        decidedAt: submittedBy && state === "approved" ? at("2026-09-23", "11:30") : null,
      };
    }),
  );
  const components = new Map<string, string>();
  for (const part of chunks(componentRows, 500))
    for (const r of await db.insert(s.assessmentComponent).values(part).returning({
      id: s.assessmentComponent.id,
      offeringId: s.assessmentComponent.offeringId,
      key: s.assessmentComponent.key,
    }))
      components.set(`${r.offeringId}|${r.key}`, r.id);
  const offeringId = new Map(offeringRows.map((o) => [`${o.sectionCode}/${o.courseCode}`, o.id]));
  const marks = currentCieMarks().map((m) => {
    const oid = offeringId.get(`${m.sectionCode}/${m.courseCode}`)!;
    return {
      tenantId,
      componentId: components.get(`${oid}|${m.componentKey}`)!,
      studentId: studentIdFor(m.studentNumber),
      marks: m.marks,
      absent: m.absent,
      enteredBy: facultyIds.get(teacher.get(`${m.sectionCode}/${m.courseCode}`)!) ?? null,
      enteredAt: at("2026-09-18", "15:00"),
    };
  });
  for (const part of chunks(marks, 2000)) await db.insert(s.assessmentMark).values(part);

  // Condonation requests for students in the band below their threshold.
  const inBand = STUDENTS.filter(
    (st) =>
      st.status === "active" && eligibilityFor(st.attendancePct, st.attendanceThreshold) === "condonable",
  ).map((st) => ({ studentNumber: st.studentNumber, sectionCode: st.sectionId, pct: st.attendancePct }));
  const requests = condonationRequests(inBand);
  if (requests.length)
    await db.insert(s.condonation).values(
      requests.map((r, i) => ({
        tenantId,
        studentId: studentIdFor(r.studentNumber),
        termId: terms.get(currentTerm.code)!,
        attendancePct: inBand.find((b) => b.studentNumber === r.studentNumber)!.pct,
        reason: r.reason,
        status: r.status,
        requestedBy: r.requestedBy ? (personaIds.get(r.requestedBy) ?? null) : null,
        requestedAt: at(`2026-10-0${1 + (i % 5)}`, "11:00"),
        decidedBy: r.status === "approved" ? coe : null,
        decidedAt: r.status === "approved" ? at("2026-10-05", "15:00") : null,
      })),
    );

  log(
    `exams: ${PAST_TERMS.length} past terms, ${PAST_RESULTS.length} results, ${SUPPLEMENTARY_REGISTRATIONS.length} supplementary and ${registrations.length} regular registrations, ${componentRows.length} components, ${marks.length} internal marks, ${requests.length} condonation requests`,
  );
}
