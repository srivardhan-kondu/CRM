/*
 * Assessment, grading, eligibility and revaluation rules (ADR-021). Chosen for the demo institution on the owner's
 * instruction, after the pattern of Indian autonomous-college regulations. Pure: the seed, the in-memory twin, the
 * services and the screens all apply the same arithmetic.
 */

export type CourseType = "theory" | "lab" | "project";

export interface ComponentSpec {
  key: string;
  label: string;
  /** Continuous internal evaluation (entered by the teacher) or semester-end examination (by the exam cell). */
  kind: "cie" | "see";
  maxMarks: number;
}

/** Components of each course type. CIE components sum to the internal maximum. */
export const SCHEMES: Record<CourseType, ComponentSpec[]> = {
  theory: [
    { key: "ia1", label: "Internal assessment 1", kind: "cie", maxMarks: 15 },
    { key: "ia2", label: "Internal assessment 2", kind: "cie", maxMarks: 15 },
    { key: "assignment", label: "Assignments", kind: "cie", maxMarks: 10 },
    { key: "see", label: "Semester-end examination", kind: "see", maxMarks: 60 },
  ],
  lab: [
    { key: "continuous", label: "Continuous evaluation", kind: "cie", maxMarks: 30 },
    { key: "labtest", label: "Internal lab test", kind: "cie", maxMarks: 20 },
    { key: "see", label: "External practical examination", kind: "see", maxMarks: 50 },
  ],
  project: [
    { key: "review1", label: "Review 1", kind: "cie", maxMarks: 20 },
    { key: "review2", label: "Review 2", kind: "cie", maxMarks: 20 },
    { key: "see", label: "Project viva voce", kind: "see", maxMarks: 60 },
  ],
};

export function cieComponents(type: CourseType): ComponentSpec[] {
  return SCHEMES[type].filter((c) => c.kind === "cie");
}

export function cieMax(type: CourseType): number {
  return cieComponents(type).reduce((n, c) => n + c.maxMarks, 0);
}

export function seeMax(type: CourseType): number {
  return SCHEMES[type].find((c) => c.kind === "see")!.maxMarks;
}

/** Minimum share of the SEE maximum, and of the course total, needed to pass. */
export const SEE_PASS_SHARE = 0.35;
export const TOTAL_PASS_SHARE = 0.4;

export type Grade = "O" | "A+" | "A" | "B+" | "B" | "C" | "P" | "F" | "Ab";

/** Absolute grading on a 10-point scale: lower bound of the total (as % of the course maximum) per grade. */
export const GRADE_BANDS: { grade: Grade; min: number; points: number }[] = [
  { grade: "O", min: 90, points: 10 },
  { grade: "A+", min: 80, points: 9 },
  { grade: "A", min: 70, points: 8 },
  { grade: "B+", min: 60, points: 7 },
  { grade: "B", min: 50, points: 6 },
  { grade: "C", min: 45, points: 5 },
  { grade: "P", min: 40, points: 4 },
];

export type Outcome = "pass" | "fail" | "absent" | "not_eligible";

export interface CourseOutcome {
  total: number;
  grade: Grade | null;
  gradePoint: number;
  outcome: Outcome;
}

/**
 * The result of one course attempt. Absent from the SEE → Ab; not eligible to sit (attendance) → no grade. A pass
 * needs both the SEE minimum and the total minimum; otherwise F.
 */
export function gradeCourse(input: {
  type: CourseType;
  cie: number;
  see: number | null;
  seeAbsent?: boolean;
  eligible?: boolean;
}): CourseOutcome {
  const total = input.cie + (input.see ?? 0);
  if (input.eligible === false)
    return { total: input.cie, grade: null, gradePoint: 0, outcome: "not_eligible" };
  if (input.seeAbsent || input.see === null)
    return { total: input.cie, grade: "Ab", gradePoint: 0, outcome: "absent" };
  const max = cieMax(input.type) + seeMax(input.type);
  const pct = (total / max) * 100;
  const seeOk = input.see >= SEE_PASS_SHARE * seeMax(input.type) - 1e-9;
  const band = GRADE_BANDS.find((b) => pct >= b.min - 1e-9);
  if (!seeOk || !band) return { total, grade: "F", gradePoint: 0, outcome: "fail" };
  return { total, grade: band.grade, gradePoint: band.points, outcome: "pass" };
}

export interface GradedCourse {
  courseCode: string;
  credits: number;
  gradePoint: number;
  outcome: Outcome;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** SGPA: credit-weighted grade points over every course attempted in the term (failed courses count as 0). */
export function sgpa(courses: readonly Pick<GradedCourse, "credits" | "gradePoint">[]): number {
  const credits = courses.reduce((n, c) => n + c.credits, 0);
  return credits ? round2(courses.reduce((n, c) => n + c.credits * c.gradePoint, 0) / credits) : 0;
}

/**
 * Standing across all published results: each course counts by its latest attempt. CGPA weighs every course taken
 * (a backlog counts 0 until cleared); credits earned are passed courses; backlogs are courses not yet passed.
 */
export function standing(attempts: readonly (GradedCourse & { attempt: number })[]) {
  const latest = new Map<string, GradedCourse & { attempt: number }>();
  for (const a of attempts) {
    const prev = latest.get(a.courseCode);
    if (!prev || a.attempt > prev.attempt) latest.set(a.courseCode, a);
  }
  const list = [...latest.values()];
  return {
    cgpa: sgpa(list),
    creditsEarned: list.filter((c) => c.outcome === "pass").reduce((n, c) => n + c.credits, 0),
    backlogs: list.filter((c) => c.outcome !== "pass").length,
  };
}

/** The same standing from pre-summed latest attempts (the database computes the sums). */
export function standingFromSums(sums: {
  credits: number;
  points: number;
  earned: number | null;
  backlogs: number;
}) {
  return {
    cgpa: sums.credits ? round2(sums.points / sums.credits) : 0,
    creditsEarned: sums.earned ?? 0,
    backlogs: sums.backlogs,
  };
}

/* ---------- Eligibility ---------- */

/** How far below the programme threshold a condonation can reach. */
export const CONDONATION_BAND = 10;

export type Eligibility = "eligible" | "condonable" | "not_eligible";

/** Attendance-based eligibility to sit the semester-end examinations. */
export function eligibilityFor(attendancePct: number, thresholdPct: number): Eligibility {
  if (attendancePct >= thresholdPct) return "eligible";
  if (attendancePct >= thresholdPct - CONDONATION_BAND) return "condonable";
  return "not_eligible";
}

/** Eligible to sit: on attendance, or in the condonation band with an approved condonation. */
export function maySit(eligibility: Eligibility, condoned: boolean): boolean {
  return eligibility === "eligible" || (eligibility === "condonable" && condoned);
}

/* ---------- Revaluation ---------- */

export const REVALUATION_DAYS = 7;

/** Revaluation re-marks the theory SEE; the student keeps the higher mark. */
export function revaluedSee(original: number, revalued: number): number {
  return Math.max(original, revalued);
}

export function revaluationOpen(publishedAt: Date, now: Date): boolean {
  return now.getTime() - publishedAt.getTime() <= REVALUATION_DAYS * 86_400_000;
}

/** Marks must be a multiple of 0.5 within the component maximum. */
export function validMark(marks: number, max: number): boolean {
  return Number.isFinite(marks) && marks >= 0 && marks <= max && Math.round(marks * 2) === marks * 2;
}
