/**
 * SYNTHETIC examination history and the current term's assessment, for the demo tenant:
 *  - published results of every completed semester (regular attempt), from 2023–24 onwards;
 *  - the September 2026 supplementary examinations for every backlog: conducted, marks entered (one course still
 *    pending), not yet published;
 *  - the current term's internal assessment: IA-1 moderated for nearly every offering, IA-2 and assignments open;
 *  - the November 2026 regular examination timetable, condonation requests.
 * The seed writes these; the in-memory twin (fixtures.ts) derives CGPA, credits and backlogs with the same rules.
 */
import { addDays, weekdayOf } from "@/domains/attendance/calendar";
import {
  cieComponents,
  cieMax,
  gradeCourse,
  seeMax,
  standing,
  type CourseType,
  type Grade,
  type Outcome,
} from "@/domains/exams/rules";
import { batchForSection, COURSE_CATALOGUE, currentTermOfferings, REGULATIONS, TERMS } from "./academics";
import { attendanceBase } from "./attendance";
import { BATCH_BY_YEAR, clamp, hash, rng, rollNumbers, SECTIONS } from "./base";

const catalogue = new Map(COURSE_CATALOGUE.map((c) => [c.code, c]));
const typeOf = (code: string) => catalogue.get(code)!.type as CourseType;
const half = (v: number) => Math.round(v * 2) / 2;

/* ---------- Past terms ---------- */

export interface PastTerm {
  code: string;
  name: string;
  kind: "odd" | "even";
  academicYear: { code: string; startsOn: string; endsOn: string };
  startsOn: string;
  endsOn: string;
  /** When its regular results were published. */
  publishedAt: string;
}

export const PAST_TERMS: PastTerm[] = [2023, 2024, 2025].flatMap((y) => {
  const yc = `${y}-${String(y + 1).slice(2)}`;
  const academicYear = { code: yc, startsOn: `${y}-06-15`, endsOn: `${y + 1}-05-31` };
  return [
    {
      code: `${yc}-ODD`,
      name: `Odd semester ${y}–${String(y + 1).slice(2)}`,
      kind: "odd" as const,
      academicYear,
      startsOn: `${y}-07-01`,
      endsOn: `${y}-11-30`,
      publishedAt: new Date(`${y + 1}-01-12T11:00:00+05:30`).toISOString(),
    },
    {
      code: `${yc}-EVEN`,
      name: `Even semester ${y}–${String(y + 1).slice(2)}`,
      kind: "even" as const,
      academicYear,
      startsOn: `${y}-12-14`,
      endsOn: `${y + 1}-05-15`,
      publishedAt: new Date(`${y + 1}-06-20T11:00:00+05:30`).toISOString(),
    },
  ];
});

/** The past term in which a batch took a semester. */
function termOfSemester(admissionYear: number, semester: number): PastTerm | undefined {
  const year = admissionYear + Math.floor((semester - 1) / 2);
  const kind = semester % 2 === 1 ? "ODD" : "EVEN";
  return PAST_TERMS.find((t) => t.code === `${year}-${String(year + 1).slice(2)}-${kind}`);
}

/* ---------- Ability ---------- */

/** A student's academic ability, correlated with how regularly they attend. */
function ability(studentNumber: string): number {
  const r = rng(hash(`ability:${studentNumber}`));
  return clamp(0.07 + 0.72 * attendanceBase(studentNumber) + (r() - 0.5) * 0.36, 0.25, 0.95);
}

function performance(studentNumber: string, courseCode: string, attempt: number) {
  const r = rng(hash(`marks:${studentNumber}:${courseCode}:${attempt}`));
  const p = clamp(ability(studentNumber) + (r() - 0.5) * 0.34 + (attempt > 1 ? 0.12 : 0), 0.08, 1);
  return { cieShare: clamp(p + 0.06 + (r() - 0.5) * 0.1, 0.1, 1), seeShare: p };
}

/* ---------- Results ---------- */

export interface ResultSpec {
  studentNumber: string;
  courseCode: string;
  termCode: string;
  semester: number;
  attempt: number;
  credits: number;
  cie: number;
  see: number | null;
  total: number;
  grade: Grade | null;
  gradePoint: number;
  outcome: Outcome;
  /** "REG-<term>" or the supplementary event code. */
  eventCode: string;
  publishedAt: string;
}

export interface StudentSpec {
  studentNumber: string;
  sectionCode: string;
  admissionYear: number;
  programmeCode: string;
  regulationCode: string;
  semester: number;
}

/** Every synthetic student with the batch facts results need. */
export const STUDENT_SPECS: StudentSpec[] = SECTIONS.flatMap((section) => {
  const b = batchForSection(section.id);
  return rollNumbers(section).map((n) => ({
    studentNumber: n,
    sectionCode: section.id,
    admissionYear: b.admissionYear,
    programmeCode: b.programmeCode,
    regulationCode: b.regulationCode,
    semester: BATCH_BY_YEAR[section.year]!.semester,
  }));
});

function regulationOf(s: Pick<StudentSpec, "programmeCode" | "regulationCode">) {
  return REGULATIONS.find((r) => r.programmeCode === s.programmeCode && r.code === s.regulationCode)!;
}

/** Credits a student's programme requires: every course of their regulation. */
export function creditsRequired(s: Pick<StudentSpec, "programmeCode" | "regulationCode">): number {
  return regulationOf(s).courses.reduce((n, c) => n + catalogue.get(c.code)!.credits, 0);
}

/**
 * The demo student carries one backlog (failed external in Discrete Mathematics) that the September supplementary
 * clears, so their results show a second attempt and a revaluation can be requested once those results are published.
 */
const SCRIPTED: Record<string, { course: string; see: number; suppSee: number }> = {
  "24CSE001": { course: "CS202", see: 17, suppSee: 31 },
};

function graded(s: StudentSpec, code: string, term: PastTerm, semester: number): ResultSpec {
  const type = typeOf(code);
  const { cieShare, seeShare } = performance(s.studentNumber, code, 1);
  const cie = half(cieMax(type) * cieShare);
  const scripted = SCRIPTED[s.studentNumber];
  const see = scripted?.course === code ? scripted.see : Math.round(seeMax(type) * seeShare);
  const g = gradeCourse({ type, cie, see });
  return {
    studentNumber: s.studentNumber,
    courseCode: code,
    termCode: term.code,
    semester,
    attempt: 1,
    credits: catalogue.get(code)!.credits,
    cie,
    see,
    total: g.total,
    grade: g.grade,
    gradePoint: g.gradePoint,
    outcome: g.outcome,
    eventCode: `REG-${term.code}`,
    publishedAt: term.publishedAt,
  };
}

/** Published regular results of every semester each student has completed. */
export const PAST_RESULTS: ResultSpec[] = STUDENT_SPECS.flatMap((s) => {
  const reg = regulationOf(s);
  const out: ResultSpec[] = [];
  for (let semester = 1; semester < s.semester; semester++) {
    const term = termOfSemester(s.admissionYear, semester);
    if (!term) continue;
    for (const c of reg.courses.filter((x) => x.semester === semester))
      out.push(graded(s, c.code, term, semester));
  }
  return out;
});

/* ---------- Supplementary examinations, September 2026 ---------- */

export const SUPPLEMENTARY = {
  code: "SUPP-2026-09",
  name: "Supplementary examinations, September 2026",
  startsOn: "2026-09-07",
  endsOn: "2026-09-12",
} as const;

export interface SupplementarySpec {
  studentNumber: string;
  courseCode: string;
  termCode: string;
  semester: number;
  /** CIE carried over from the earlier attempt. */
  cie: number;
  /** Null while the exam cell has not entered it yet. */
  see: number | null;
  seeAbsent: boolean;
}

/** Every backlog sits the September supplementary exam; one course's marks are still to be entered. */
export const SUPPLEMENTARY_REGISTRATIONS: SupplementarySpec[] = (() => {
  const failed = PAST_RESULTS.filter((r) => r.outcome !== "pass");
  const pendingCourse = [...new Set(failed.map((f) => f.courseCode))].sort()[0];
  return failed.map((f) => {
    const type = typeOf(f.courseCode);
    const r = rng(hash(`supp:${f.studentNumber}:${f.courseCode}`));
    const absent = r() < 0.06;
    const { seeShare } = performance(f.studentNumber, f.courseCode, 2);
    return {
      studentNumber: f.studentNumber,
      courseCode: f.courseCode,
      termCode: f.termCode,
      semester: f.semester,
      cie: f.cie,
      see:
        SCRIPTED[f.studentNumber]?.course === f.courseCode
          ? SCRIPTED[f.studentNumber]!.suppSee
          : f.courseCode === pendingCourse || absent
            ? null
            : Math.round(seeMax(type) * seeShare),
      seeAbsent: absent && f.courseCode !== pendingCourse && !SCRIPTED[f.studentNumber],
    };
  });
})();

/** The course whose supplementary marks the exam cell has not entered yet (publishing waits for it). */
export const SUPPLEMENTARY_PENDING_COURSE = SUPPLEMENTARY_REGISTRATIONS.find(
  (r) => r.see === null && !r.seeAbsent,
)?.courseCode;

/** Standing from published results only (the supplementary results are not published at DEMO_NOW). */
export function standingFor(studentNumber: string) {
  return standing(
    PAST_RESULTS.filter((r) => r.studentNumber === studentNumber).map((r) => ({
      courseCode: r.courseCode,
      credits: r.credits,
      gradePoint: r.gradePoint,
      outcome: r.outcome,
      attempt: r.attempt,
    })),
  );
}

/* ---------- Current term: internal assessment ---------- */

export interface CieMarkSpec {
  sectionCode: string;
  courseCode: string;
  componentKey: string;
  studentNumber: string;
  marks: number | null;
  absent: boolean;
}

export type ComponentState = "open" | "submitted" | "approved";

/**
 * Where each current-term component stands. The first CIE component is moderated for every allocated offering, except
 * Rahul Verma's CS301 IA-1 for 3-CSE-A (submitted, waiting for the HOD) and Kavya Nair's CS302 IA-1 for 3-CSE-A (still
 * being entered). Everything else is open.
 */
export function componentState(
  sectionCode: string,
  courseCode: string,
  componentKey: string,
): ComponentState {
  const first = cieComponents(typeOf(courseCode))[0]!.key;
  if (componentKey !== first) return "open";
  if (sectionCode === "CSE-3-A" && courseCode === "CS301") return "submitted";
  if (sectionCode === "CSE-3-A" && courseCode === "CS302") return "open";
  return "approved";
}

/** Marks entered so far: the first CIE component of allocated offerings (Kavya's in-progress one is half done). */
export function currentCieMarks(): CieMarkSpec[] {
  const out: CieMarkSpec[] = [];
  for (const o of currentTermOfferings()) {
    if (!o.facultyName) continue;
    const section = SECTIONS.find((s) => s.id === o.sectionCode)!;
    const component = cieComponents(typeOf(o.courseCode))[0]!;
    const inProgress = o.sectionCode === "CSE-3-A" && o.courseCode === "CS302";
    rollNumbers(section).forEach((n, i) => {
      if (inProgress && i >= 7) return;
      const r = rng(hash(`cie:${n}:${o.courseCode}:${component.key}`));
      const absent = r() < 0.03;
      const { cieShare } = performance(n, o.courseCode, 1);
      out.push({
        sectionCode: o.sectionCode,
        courseCode: o.courseCode,
        componentKey: component.key,
        studentNumber: n,
        marks: absent ? null : half(component.maxMarks * cieShare),
        absent,
      });
    });
  }
  return out;
}

/* ---------- November 2026 regular examinations ---------- */

export const REGULAR_EVENT = {
  code: `REG-${TERMS.find((t) => t.isCurrent)!.code}`,
  name: "Semester-end examinations, November 2026",
  startsOn: "2026-11-16",
  endsOn: "2026-11-28",
} as const;

/**
 * One sitting per course across sections, forenoon for first and third years and afternoon for second and fourth.
 * Each course takes the earliest exam day on which none of the sections sitting it already has a paper in that
 * session, so no student has two papers at once (courses shared across programmes included).
 */
export function regularSchedule(): { courseCode: string; date: string; session: "FN" | "AN" }[] {
  const days: string[] = [];
  for (let d: string = REGULAR_EVENT.startsOn; days.length < 11; d = addDays(d, 1))
    if (weekdayOf(d) !== 7) days.push(d);
  const sectionsOf = new Map<string, string[]>();
  for (const o of currentTermOfferings())
    sectionsOf.set(o.courseCode, [...(sectionsOf.get(o.courseCode) ?? []), o.sectionCode]);
  const busy = new Set<string>();
  const out: { courseCode: string; date: string; session: "FN" | "AN" }[] = [];
  // Shared courses first: they constrain the most sections.
  const courses = [...sectionsOf.keys()].sort(
    (a, b) => sectionsOf.get(b)!.length - sectionsOf.get(a)!.length || a.localeCompare(b),
  );
  for (const courseCode of courses) {
    const sections = sectionsOf.get(courseCode)!;
    const year = SECTIONS.find((s) => s.id === sections[0])!.year;
    const session: "FN" | "AN" = year % 2 ? "FN" : "AN";
    const date = days.find((d) => sections.every((sec) => !busy.has(`${sec}|${d}|${session}`)));
    if (!date) throw new Error(`Exam timetable: no day for ${courseCode}`);
    for (const sec of sections) busy.add(`${sec}|${date}|${session}`);
    out.push({ courseCode, date, session });
  }
  return out.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
}

/* ---------- Condonation ---------- */

export interface CondonationSpec {
  studentNumber: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
}

/** Condonation requests for students in the band below their threshold (decided by the principal or the CoE). */
export function condonationRequests(
  inBand: readonly { studentNumber: string; sectionCode: string }[],
): CondonationSpec[] {
  return inBand
    .filter((s) => s.sectionCode.startsWith("CSE-"))
    .slice(0, 6)
    .map((s, i) => ({
      studentNumber: s.studentNumber,
      reason:
        i % 2 === 0
          ? "Prolonged illness during August; medical certificates submitted."
          : "Represented the college at inter-university sports; letters from the physical director.",
      status: i < 4 ? "pending" : "approved",
      requestedBy: s.sectionCode === "CSE-3-A" ? "class_incharge" : null,
    }));
}
