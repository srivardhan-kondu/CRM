/** Semester a batch is in during a term: two terms per academic year, counted from admission. */
export function semesterFor(
  admissionYear: number,
  academicYearStart: number,
  kind: "odd" | "even" | "summer",
) {
  return (academicYearStart - admissionYear) * 2 + (kind === "even" ? 2 : 1);
}

export interface PlanInputs {
  term: { academicYearStart: number; kind: "odd" | "even" | "summer" };
  sections: readonly { sectionId: string; admissionYear: number; curriculumId: string; semesters: number }[];
  courses: readonly { curriculumId: string; courseId: string; semester: number }[];
  existing: readonly { courseId: string; sectionId: string }[];
}

export interface PlannedOffering {
  sectionId: string;
  courseId: string;
  semester: number;
}

/**
 * Offerings a term still needs: for each section, the courses its batch's regulation places in the semester the
 * batch is in, minus offerings that already exist. Sections not yet admitted or already graduated get nothing;
 * summer terms are planned by hand.
 */
export function planOfferings(
  input: PlanInputs,
  sectionFilter?: (sectionId: string) => boolean,
): PlannedOffering[] {
  if (input.term.kind === "summer") return [];
  const existing = new Set(input.existing.map((e) => `${e.courseId}/${e.sectionId}`));
  const out: PlannedOffering[] = [];
  for (const sec of input.sections) {
    if (sectionFilter && !sectionFilter(sec.sectionId)) continue;
    const semester = semesterFor(sec.admissionYear, input.term.academicYearStart, input.term.kind);
    if (semester < 1 || semester > sec.semesters) continue;
    for (const c of input.courses) {
      if (c.curriculumId !== sec.curriculumId || c.semester !== semester) continue;
      if (existing.has(`${c.courseId}/${sec.sectionId}`)) continue;
      out.push({ sectionId: sec.sectionId, courseId: c.courseId, semester });
    }
  }
  return out;
}

/** Semesters (1..n) with no course in a regulation — a regulation cannot be published with gaps. */
export function emptySemesters(semesters: number, courseSemesters: readonly number[]): number[] {
  const present = new Set(courseSemesters);
  return Array.from({ length: semesters }, (_, i) => i + 1).filter((n) => !present.has(n));
}
