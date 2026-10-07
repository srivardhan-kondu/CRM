import { describe, expect, it } from "vitest";
import { projectAttendance } from "@/domains/attendance/projection";
import { parseStudentQuery, toSearchParams } from "@/domains/students/params";
import { toStudentRow, visibleSubjects, visibleTimeline } from "@/domains/students/projection";
import { studentFieldAccess } from "@/lib/authz/engine";
import { STUDENTS, subjectAttendanceFor, timelineFor } from "@/lib/demo/fixtures";
import { ctxFor, demoTree, ref } from "../helpers/demo-authz";

const withDues = STUDENTS.find((s) => s.sectionId === "CSE-3-A" && s.feeStatus !== "paid")!;
const accessOf = (key: string) => studentFieldAccess(ctxFor(key), demoTree, ref(withDues));

describe("projection strips hidden fields before they reach the client", () => {
  it("omits finance for academic staff", () => {
    for (const key of ["hod_cse", "class_incharge", "faculty"]) {
      const row = toStudentRow(withDues, accessOf(key));
      expect(row).not.toHaveProperty("feeStatus");
      expect(row).not.toHaveProperty("feeDue");
    }
    expect(toStudentRow(withDues, accessOf("principal")).feeStatus).toBe(withDues.feeStatus);
  });

  it("gives faculty no cohort academics, risk or contact details", () => {
    const row = toStudentRow(withDues, accessOf("faculty"));
    for (const key of ["attendancePct", "cgpa", "risk", "email", "phone"])
      expect(row).not.toHaveProperty(key);
  });

  it("limits subject attendance to the courses a faculty member teaches", () => {
    expect(
      visibleSubjects(subjectAttendanceFor(withDues.id), accessOf("faculty")).map((s) => s.courseCode),
    ).toEqual(["CS301"]);
    expect(visibleSubjects(subjectAttendanceFor(withDues.id), accessOf("class_incharge"))).toHaveLength(5);
  });

  it("filters fee events out of the timeline without finance access", () => {
    const events = timelineFor(withDues);
    expect(events.some((e) => e.kind === "fee")).toBe(true);
    expect(visibleTimeline(events, accessOf("hod_cse")).some((e) => e.kind === "fee")).toBe(false);
    expect(visibleTimeline(events, accessOf("principal")).some((e) => e.kind === "fee")).toBe(true);
  });

  it("does not use finance as a risk factor visible to academic staff", () => {
    expect(STUDENTS.every((s) => s.risk.factors.every((f) => (f.key as string) !== "fees"))).toBe(true);
  });
});

describe("attendance projection", () => {
  it("computes how many classes can be missed while compliant", () => {
    expect(projectAttendance(30, 36, 75)).toMatchObject({ canMiss: 4, mustAttend: 0 });
  });

  it("computes consecutive classes needed to recover", () => {
    expect(projectAttendance(20, 30, 75)).toMatchObject({ canMiss: 0, mustAttend: 10 });
  });

  it("handles the exact threshold and empty records", () => {
    expect(projectAttendance(30, 40, 75)).toMatchObject({ canMiss: 0, mustAttend: 0 });
    expect(projectAttendance(0, 0, 75)).toMatchObject({ pct: 100, canMiss: 0, mustAttend: 0 });
  });
});

describe("student query params", () => {
  it("drops invalid values instead of failing the page", () => {
    // Department codes are data since Phase 2: any well-formed code parses (an unknown one matches nothing),
    // malformed ones are dropped.
    const q = parseStudentQuery({
      department: "cse'; --",
      year: "9",
      section: "'; drop",
      page: "-2",
      risk: "high",
    });
    expect(q).toMatchObject({
      department: undefined,
      year: undefined,
      sectionId: undefined,
      page: undefined,
      risk: "high",
    });
  });

  it("round-trips through URL params", () => {
    const q = parseStudentQuery({
      q: "sharma",
      department: "CSE",
      year: "3",
      section: "CSE-3-A",
      shortage: "1",
      sort: "attendance",
      dir: "desc",
      page: "2",
    });
    expect(parseStudentQuery(Object.fromEntries(toSearchParams(q)))).toEqual(q);
  });
});
