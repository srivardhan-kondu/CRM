import { describe, expect, it } from "vitest";
import {
  canDecideCondonation,
  canEnterMarks,
  canManageExams,
  canModerateIn,
  canRequestCondonationFor,
  canRequestRevaluationFor,
} from "@/domains/exams/guards";
import {
  cieMax,
  eligibilityFor,
  gradeCourse,
  maySit,
  revaluationOpen,
  revaluedSee,
  seeMax,
  sgpa,
  standing,
  validMark,
} from "@/domains/exams/rules";
import { COURSE_CATALOGUE, currentTermOfferings } from "@/lib/demo/academics";
import { STUDENTS } from "@/lib/demo/fixtures";
import {
  componentState,
  PAST_RESULTS,
  regularSchedule,
  SUPPLEMENTARY_PENDING_COURSE,
  SUPPLEMENTARY_REGISTRATIONS,
} from "@/lib/demo/results";
import { ctxFor, demoTree } from "../helpers/demo-authz";

const unit = (code: string) => demoTree.byCode.get(code)!.id;
const ref = (studentNumber: string) => {
  const s = STUDENTS.find((x) => x.studentNumber === studentNumber)!;
  return { tenantId: ctxFor("principal").tenantId, studentNumber, sectionCode: s.sectionId };
};

describe("assessment scheme", () => {
  it("splits marks by course type", () => {
    expect([cieMax("theory"), seeMax("theory")]).toEqual([40, 60]);
    expect([cieMax("lab"), seeMax("lab")]).toEqual([50, 50]);
    expect([cieMax("project"), seeMax("project")]).toEqual([40, 60]);
  });

  it("accepts half marks within the maximum only", () => {
    expect(validMark(12.5, 15)).toBe(true);
    expect(validMark(15, 15)).toBe(true);
    expect(validMark(15.5, 15)).toBe(false);
    expect(validMark(12.3, 15)).toBe(false);
    expect(validMark(-1, 15)).toBe(false);
  });
});

describe("grading", () => {
  it("grades absolutely on the 10-point scale", () => {
    expect(gradeCourse({ type: "theory", cie: 36, see: 54 })).toMatchObject({
      total: 90,
      grade: "O",
      gradePoint: 10,
    });
    expect(gradeCourse({ type: "theory", cie: 30, see: 50 })).toMatchObject({ grade: "A+", gradePoint: 9 });
    expect(gradeCourse({ type: "theory", cie: 20, see: 25 })).toMatchObject({
      total: 45,
      grade: "C",
      gradePoint: 5,
    });
    expect(gradeCourse({ type: "theory", cie: 19, see: 21 })).toMatchObject({
      total: 40,
      grade: "P",
      outcome: "pass",
    });
  });

  it("needs 35% in the external examination as well as 40% overall", () => {
    // 38 internal + 20 external = 58% overall, but 20/60 is below 35%.
    expect(gradeCourse({ type: "theory", cie: 38, see: 20 })).toMatchObject({ grade: "F", outcome: "fail" });
    expect(gradeCourse({ type: "theory", cie: 10, see: 25 })).toMatchObject({ grade: "F", outcome: "fail" });
    // Lab: 18/50 external clears 35%; 48% overall is a C.
    expect(gradeCourse({ type: "lab", cie: 30, see: 18 })).toMatchObject({ grade: "C", outcome: "pass" });
  });

  it("records absence and ineligibility without a grade point", () => {
    expect(gradeCourse({ type: "theory", cie: 30, see: null, seeAbsent: true })).toMatchObject({
      grade: "Ab",
      gradePoint: 0,
      outcome: "absent",
    });
    expect(gradeCourse({ type: "theory", cie: 30, see: 50, eligible: false })).toMatchObject({
      grade: null,
      outcome: "not_eligible",
    });
  });

  it("weighs SGPA by credits and counts each course's latest attempt in CGPA", () => {
    expect(
      sgpa([
        { credits: 4, gradePoint: 10 },
        { credits: 2, gradePoint: 7 },
      ]),
    ).toBe(9);
    const attempts = [
      { courseCode: "MA101", credits: 4, gradePoint: 0, outcome: "fail" as const, attempt: 1 },
      { courseCode: "MA101", credits: 4, gradePoint: 6, outcome: "pass" as const, attempt: 2 },
      { courseCode: "PH101", credits: 3, gradePoint: 8, outcome: "pass" as const, attempt: 1 },
      { courseCode: "CS101", credits: 3, gradePoint: 0, outcome: "fail" as const, attempt: 1 },
    ];
    // (4×6 + 3×8 + 3×0) / 10: the MA101 retake replaces its failed first attempt.
    expect(standing(attempts)).toEqual({ cgpa: 4.8, creditsEarned: 7, backlogs: 1 });
  });
});

describe("eligibility and revaluation", () => {
  it("allows condonation within 10 points below the programme threshold", () => {
    expect(eligibilityFor(80, 75)).toBe("eligible");
    expect(eligibilityFor(75, 75)).toBe("eligible");
    expect(eligibilityFor(70.2, 75)).toBe("condonable");
    expect(eligibilityFor(64.9, 75)).toBe("not_eligible");
    expect(eligibilityFor(72, 80)).toBe("condonable");
    expect(maySit("condonable", false)).toBe(false);
    expect(maySit("condonable", true)).toBe(true);
    expect(maySit("not_eligible", true)).toBe(false);
  });

  it("keeps the higher mark and closes the window after 7 days", () => {
    expect(revaluedSee(30, 34)).toBe(34);
    expect(revaluedSee(30, 26)).toBe(30);
    const published = new Date("2026-10-06T11:00:00+05:30");
    expect(revaluationOpen(published, new Date("2026-10-13T10:00:00+05:30"))).toBe(true);
    expect(revaluationOpen(published, new Date("2026-10-13T12:00:00+05:30"))).toBe(false);
  });
});

describe("who may assess and examine", () => {
  it("lets teachers enter marks only for the courses they teach; the class incharge for their class", () => {
    expect(canEnterMarks(ctxFor("faculty"), demoTree, unit("CSE-3-A"), "CS301")).toBe(true);
    expect(canEnterMarks(ctxFor("faculty"), demoTree, unit("CSE-3-A"), "CS302")).toBe(false);
    expect(canEnterMarks(ctxFor("class_incharge"), demoTree, unit("CSE-3-A"), "CS303")).toBe(true);
    expect(canEnterMarks(ctxFor("exam_controller"), demoTree, unit("CSE-3-A"), "CS301")).toBe(false);
  });

  it("gives moderation to the HOD within the department and the exam cell to the CoE and principal", () => {
    expect(canModerateIn(ctxFor("hod_cse"), demoTree, unit("CSE-3-A"))).toBe(true);
    expect(canModerateIn(ctxFor("hod_cse"), demoTree, unit("MECH-2-A"))).toBe(false);
    expect(canModerateIn(ctxFor("faculty"), demoTree, unit("CSE-3-A"))).toBe(false);
    expect(canManageExams(ctxFor("exam_controller"), demoTree)).toBe(true);
    expect(canManageExams(ctxFor("principal"), demoTree)).toBe(true);
    expect(canManageExams(ctxFor("hod_cse"), demoTree)).toBe(false);
    expect(canDecideCondonation(ctxFor("exam_controller"), demoTree)).toBe(true);
    expect(canDecideCondonation(ctxFor("class_incharge"), demoTree)).toBe(false);
  });

  it("lets the class incharge request condonation and students request their own revaluation", () => {
    expect(canRequestCondonationFor(ctxFor("class_incharge"), demoTree, ref("24CSE005"))).toBe(true);
    expect(canRequestCondonationFor(ctxFor("class_incharge"), demoTree, ref("24CSE030"))).toBe(false);
    expect(canRequestRevaluationFor(ctxFor("student"), demoTree, ref("24CSE001"))).toBe(true);
    expect(canRequestRevaluationFor(ctxFor("student"), demoTree, ref("24CSE002"))).toBe(false);
    expect(canRequestRevaluationFor(ctxFor("parent"), demoTree, ref("24CSE001"))).toBe(false);
  });
});

describe("synthetic examination history", () => {
  const typeOf = new Map(COURSE_CATALOGUE.map((c) => [c.code, c.type]));

  it("grades every published result by the rules", () => {
    for (const r of PAST_RESULTS.filter((_, i) => i % 7 === 0))
      expect(gradeCourse({ type: typeOf.get(r.courseCode)!, cie: r.cie, see: r.see })).toMatchObject({
        grade: r.grade,
        gradePoint: r.gradePoint,
        outcome: r.outcome,
      });
  });

  it("registers every backlog for the supplementary sitting, with one paper still to enter", () => {
    const backlogs = PAST_RESULTS.filter((r) => r.outcome !== "pass");
    expect(SUPPLEMENTARY_REGISTRATIONS).toHaveLength(backlogs.length);
    expect(SUPPLEMENTARY_PENDING_COURSE).toBeDefined();
    const pending = SUPPLEMENTARY_REGISTRATIONS.filter((r) => r.see === null && !r.seeAbsent);
    expect(new Set(pending.map((r) => r.courseCode))).toEqual(new Set([SUPPLEMENTARY_PENDING_COURSE]));
  });

  it("never gives a section two November papers in the same sitting", () => {
    const slot = new Map(regularSchedule().map((x) => [x.courseCode, `${x.date} ${x.session}`]));
    const bySection = new Map<string, string[]>();
    for (const o of currentTermOfferings())
      bySection.set(o.sectionCode, [...(bySection.get(o.sectionCode) ?? []), slot.get(o.courseCode)!]);
    for (const [section, slots] of bySection) expect(new Set(slots).size, section).toBe(slots.length);
    expect([...slot.values()].every((s) => s >= "2026-11-16" && s <= "2026-11-28 AN")).toBe(true);
  });

  it("scripts the persona courses' internal assessment state", () => {
    expect(componentState("CSE-3-A", "CS301", "ia1")).toBe("submitted");
    expect(componentState("CSE-3-A", "CS302", "ia1")).toBe("open");
    expect(componentState("CSE-3-B", "CS301", "ia1")).toBe("approved");
    expect(componentState("CSE-3-B", "CS301", "ia2")).toBe("open");
  });
});
