/**
 * SYNTHETIC DEMO DATA — every person, ID and organisation here is generated and fictitious.
 *
 * The in-memory twin of the seeded institution. The seed writes students' identity and placement from here, and
 * unit tests use STUDENTS as the database's twin. Attendance is aggregated from the synthetic history
 * (attendance.ts) and CGPA, credits and backlogs from the published results (results.ts), with the same rules the
 * database applies. Fees are still deterministic signals (`syntheticSignals`) until Phase 7, and the activity timeline
 * is synthetic.
 */
import { percentOf, sumTallies, type Tally } from "@/domains/attendance/rules";
import type {
  FeeStatus,
  RiskFactor,
  RiskLevel,
  Student,
  StudentStatus,
  SubjectAttendance,
  TimelineEvent,
} from "@/domains/students/types";
import { attendanceTallies, PROGRAMME_THRESHOLDS } from "./attendance";
import { creditsRequired, standingFor, STUDENT_SPECS } from "./results";
import {
  ATTENDANCE_THRESHOLD,
  BACKLOG_THRESHOLD,
  BATCH_BY_YEAR,
  CGPA_THRESHOLD,
  clamp,
  coursesFor,
  DEMO_NOW,
  DEPARTMENTS,
  FACULTY_BY_DEPT,
  FIRST_F,
  FIRST_M,
  hash,
  LAST,
  pick,
  rng,
  rollNumbers,
  round1,
  SECTIONS,
  studentIdFor,
} from "./base";

export * from "./base";

function daysAgo(days: number, hour = 10): string {
  const d = new Date(DEMO_NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function evaluateRisk(
  s: Pick<Student, "attendancePct" | "attendanceThreshold" | "cgpa" | "backlogs" | "year">,
): {
  level: RiskLevel;
  factors: RiskFactor[];
} {
  const factors: RiskFactor[] = [];
  if (s.attendancePct < s.attendanceThreshold) {
    factors.push({
      key: "attendance",
      label: "Attendance shortage",
      detail: `Overall attendance is ${s.attendancePct.toFixed(1)}%.`,
      threshold: `Below the programme's ${s.attendanceThreshold}% exam eligibility threshold`,
    });
  }
  if (s.year > 1 && s.cgpa < CGPA_THRESHOLD) {
    factors.push({
      key: "academic",
      label: "Low CGPA",
      detail: `CGPA is ${s.cgpa.toFixed(2)}.`,
      threshold: `CGPA below ${CGPA_THRESHOLD.toFixed(1)}`,
    });
  }
  if (s.backlogs >= BACKLOG_THRESHOLD) {
    factors.push({
      key: "backlogs",
      label: "Multiple backlogs",
      detail: `${s.backlogs} courses pending clearance.`,
      threshold: `${BACKLOG_THRESHOLD} or more active backlogs`,
    });
  }
  // Fee blockage is deliberately NOT a factor here: risk is visible to academic staff who must not infer
  // finance data (PRD §4). It joins as a field-masked factor once finance permissions exist (Phase 7, ADR-005).
  const severe = s.attendancePct < 65;
  const level: RiskLevel = factors.length >= 2 || severe ? "high" : factors.length === 1 ? "watch" : "none";
  return { level, factors };
}

export interface SyntheticSignals {
  /**
   * Phase 2's synthetic attendance figure. It no longer feeds any screen (attendance is recorded now); it still
   * decides which seeded students were detained, so those records stay as Phase 2 created them.
   */
  legacyAttendancePct: number;
  cgpa: number;
  backlogs: number;
  creditsEarned: number;
  creditsRequired: number;
  feeStatus: FeeStatus;
  feeDue: number;
}

/**
 * Deterministic stand-ins for results and credits (Phase 4) and fees (Phase 7), keyed by student number so they are
 * stable for any student, seeded or edited. `courses` is the student's section offerings for the current term. The
 * draws are unchanged since Phase 2, so every seeded student keeps the same values.
 */
export function syntheticSignals(input: {
  studentNumber: string;
  year: number;
  semester: number;
  durationYears: number;
  courses: readonly { code: string; name: string }[];
}): SyntheticSignals {
  const r = rng(hash(`signals:${input.studentNumber}`));
  const roll = r();
  const base = roll < 0.05 ? 0.55 + r() * 0.1 : roll < 0.16 ? 0.66 + r() * 0.08 : 0.77 + r() * 0.2;
  let held = 0;
  let attended = 0;
  for (let i = 0; i < input.courses.length; i++) {
    const h = 30 + Math.floor(r() * 12);
    held += h;
    attended += Math.round(h * clamp(base + (r() - 0.5) * 0.12, 0.35, 1));
  }
  const legacyAttendancePct = held ? round1((attended / held) * 100) : round1(base * 100);

  const cgpa = input.semester <= 1 ? 0 : round1(clamp(5 + r() * 4.6 + (base - 0.8) * 3, 4.6, 9.8));
  const backlogs =
    cgpa > 0 && cgpa < 6.5 ? 1 + Math.floor(r() * 3) : cgpa > 0 && cgpa < 7.2 && r() < 0.2 ? 1 : 0;
  const creditsPerSem = input.durationYears === 4 ? 20 : 22;
  const creditsRequired = input.durationYears === 4 ? 160 : 88;
  const creditsEarned = Math.max(0, (input.semester - 1) * creditsPerSem - backlogs * 3);

  const feeRoll = r();
  const feeStatus: FeeStatus = feeRoll < 0.7 ? "paid" : feeRoll < 0.9 ? "due" : "overdue";
  const feeDue = feeStatus === "paid" ? 0 : Math.round((15 + r() * 45) * 1000);
  return { legacyAttendancePct, cgpa, backlogs, creditsEarned, creditsRequired, feeStatus, feeDue };
}

/** A student's attendance fields from per-course tallies: every course of the section, in course order. */
export function attendanceFields(
  courses: readonly { code: string; name: string }[],
  tallies: ReadonlyMap<string, Tally> | undefined,
) {
  const subjects: SubjectAttendance[] = courses.map((c) => {
    const t = tallies?.get(c.code);
    return {
      courseCode: c.code,
      courseName: c.name,
      held: t?.held ?? 0,
      attended: t?.attended ?? 0,
      od: t?.od ?? 0,
      excused: t?.excused ?? 0,
    };
  });
  return { subjects, attendancePct: percentOf(sumTallies(subjects)) };
}

/** CGPA, credits and backlogs from the student's published results (results.ts), as the database computes them. */
function academicStanding(studentNumber: string) {
  const spec = STUDENT_SPECS.find((s) => s.studentNumber === studentNumber)!;
  const { cgpa, creditsEarned, backlogs } = standingFor(studentNumber);
  return { cgpa, creditsEarned, backlogs, creditsRequired: creditsRequired(spec) };
}

interface GeneratedStudent {
  student: Student;
  subjects: SubjectAttendance[];
}

function generate(): GeneratedStudent[] {
  const tallies = attendanceTallies();
  const out: GeneratedStudent[] = [];
  for (const section of SECTIONS) {
    const dept = DEPARTMENTS.find((d) => d.code === section.departmentCode)!;
    const sectionIndex = dept.sections.indexOf(section.letter);
    const batch = BATCH_BY_YEAR[section.year]!;
    const faculty = FACULTY_BY_DEPT[dept.code] ?? ["Faculty Mentor"];
    const courses = coursesFor(dept.code, section.year);
    const attendanceThreshold = PROGRAMME_THRESHOLDS[dept.code] ?? ATTENDANCE_THRESHOLD;

    for (const studentNumber of rollNumbers(section)) {
      const r = rng(hash(studentNumber));
      const gender: "F" | "M" = r() < 0.46 ? "F" : "M";
      const first = pick(r, gender === "F" ? FIRST_F : FIRST_M);
      const last = pick(r, LAST);
      const name = `${first} ${last}`;
      const { legacyAttendancePct, feeStatus, feeDue } = syntheticSignals({
        studentNumber,
        year: section.year,
        semester: batch.semester,
        durationYears: dept.years,
        courses,
      });
      const status: StudentStatus =
        r() < 0.015 ? "on_leave" : legacyAttendancePct < 62 && r() < 0.3 ? "detained" : "active";
      const { subjects, attendancePct } = attendanceFields(courses, tallies.get(studentNumber));
      const academics = academicStanding(studentNumber);

      const student: Student = {
        id: studentIdFor(studentNumber),
        studentNumber,
        name,
        gender,
        email: `${first.toLowerCase()}.${studentNumber.toLowerCase()}@students.demo.campusos.dev`,
        phone: `+91 9${String(Math.floor(r() * 1e9)).padStart(9, "0")}`,
        departmentCode: dept.code,
        programme: dept.programme,
        batch: section.batch,
        year: section.year,
        semester: batch.semester,
        sectionId: section.id,
        sectionLabel: section.label,
        status,
        attendancePct,
        attendanceThreshold,
        ...academics,
        feeStatus,
        feeDue,
        risk: evaluateRisk({ attendancePct, attendanceThreshold, ...academics, year: section.year }),
        mentorName: faculty[(sectionIndex + section.year) % faculty.length]!,
        hosteller: r() < 0.38,
        admittedOn: `${batch.start}-08-${String(1 + Math.floor(r() * 20)).padStart(2, "0")}`,
        guardian: {
          name: `${pick(r, FIRST_M)} ${last}`,
          relation: r() < 0.7 ? "Father" : r() < 0.9 ? "Mother" : "Guardian",
          phone: `+91 9${String(Math.floor(r() * 1e9)).padStart(9, "0")}`,
        },
      };
      out.push({ student, subjects });
    }
  }
  return out;
}

const GENERATED = generate();

export const STUDENTS: readonly Student[] = GENERATED.map((g) => g.student);

const SUBJECTS_BY_ID = new Map(GENERATED.map((g) => [g.student.id, g.subjects]));

export function subjectAttendanceFor(studentId: string): SubjectAttendance[] {
  return SUBJECTS_BY_ID.get(studentId) ?? [];
}

/** Synthetic activity (alerts, fees, mentoring, results) until those domains record real events. */
export function timelineFor(student: Student): TimelineEvent[] {
  const r = rng(hash(`timeline:${student.id}`));
  const events: TimelineEvent[] = [];
  const push = (days: number, e: Omit<TimelineEvent, "id" | "at">) =>
    events.push({ ...e, id: `${student.id}-${events.length}`, at: daysAgo(days, 9 + Math.floor(r() * 8)) });

  if (student.attendancePct < student.attendanceThreshold) {
    push(2, {
      kind: "attendance",
      title: "Attendance shortage alert raised",
      detail: `Overall attendance dropped to ${student.attendancePct.toFixed(1)}% (threshold ${student.attendanceThreshold}%).`,
    });
  }
  push(4, {
    kind: "notice",
    title: "Acknowledged: Internal Assessment II schedule",
    detail: "Read and acknowledged the department notice.",
  });
  if (student.feeStatus !== "paid") {
    push(9, {
      kind: "fee",
      title: student.feeStatus === "overdue" ? "Fee instalment overdue" : "Fee instalment due",
      detail: `Outstanding balance ₹${student.feeDue.toLocaleString("en-IN")}.`,
    });
  } else {
    push(21, { kind: "fee", title: "Semester fee paid", detail: "Odd semester tuition fee receipt issued." });
  }
  push(12, {
    kind: "mentoring",
    title: `Mentor meeting with ${student.mentorName}`,
    detail:
      student.risk.level === "none"
        ? "Routine check-in; no concerns recorded."
        : "Discussed attendance and academic plan.",
  });
  if (student.year > 1 || student.programme === "MBA" || student.programme === "MCA") {
    push(64, {
      kind: "academic",
      title: `Semester ${student.semester - 1} results published`,
      detail: student.cgpa > 0 ? `CGPA updated to ${student.cgpa.toFixed(2)}.` : "Results recorded.",
    });
  }
  push(68, {
    kind: "enrollment",
    title: `Enrolled in semester ${student.semester}`,
    detail: `${student.programme}, section ${student.sectionLabel}.`,
  });
  return events.sort((a, b) => b.at.localeCompare(a.at));
}
