import { describe, expect, it } from "vitest";
import { canAllocate, canManageAt, canManageTerms, canViewFacultyIn } from "@/domains/academics/guards";
import { emptySemesters, planOfferings, semesterFor } from "@/domains/academics/plan";
import { buildStudent, type StudentRow } from "@/domains/students/load";
import { parseScopeKey, placementInTerm, scopeKey, studentScope } from "@/domains/students/scope";
import { roleDefinition } from "@/lib/authz/catalogue";
import { deriveTeachingAssignments } from "@/lib/authz/teaching";
import {
  BATCHES,
  COURSE_CATALOGUE,
  currentTermOfferings,
  FACULTY,
  PROGRAMMES,
  REGULATIONS,
} from "@/lib/demo/academics";
import { attendanceTallies, PROGRAMME_THRESHOLDS } from "@/lib/demo/attendance";
import { creditsRequired, standingFor, STUDENT_SPECS } from "@/lib/demo/results";
import { ATTENDANCE_THRESHOLD, coursesFor, STUDENTS } from "@/lib/demo/fixtures";
import { ctxFor, demoTree } from "../helpers/demo-authz";

const FACULTY_PERMS = new Set(roleDefinition("faculty")!.permissions);
const unit = (code: string) => demoTree.byCode.get(code)!.id;

describe("offering planning", () => {
  it("counts semesters from admission, two terms a year", () => {
    expect(semesterFor(2024, 2026, "odd")).toBe(5);
    expect(semesterFor(2024, 2026, "even")).toBe(6);
    expect(semesterFor(2026, 2026, "odd")).toBe(1);
    expect(placementInTerm(2024, 2026, "odd")).toEqual({ year: 3, semester: 5 });
    expect(placementInTerm(2025, 2026, "even")).toEqual({ year: 2, semester: 4 });
  });

  const inputs = {
    term: { academicYearStart: 2026, kind: "even" as const },
    sections: [
      { sectionId: "A", admissionYear: 2024, curriculumId: "R24", semesters: 8 },
      { sectionId: "OLD", admissionYear: 2022, curriculumId: "R22", semesters: 8 },
      { sectionId: "NEW", admissionYear: 2027, curriculumId: "R24", semesters: 8 },
    ],
    courses: [
      { curriculumId: "R24", courseId: "c6a", semester: 6 },
      { curriculumId: "R24", courseId: "c6b", semester: 6 },
      { curriculumId: "R24", courseId: "c5", semester: 5 },
      { curriculumId: "R22", courseId: "x", semester: 6 },
    ],
    existing: [{ courseId: "c6a", sectionId: "A" }],
  };

  it("plans the regulation's courses for the batch's semester, minus what exists", () => {
    expect(planOfferings(inputs)).toEqual([{ sectionId: "A", courseId: "c6b", semester: 6 }]);
  });

  it("skips graduated and not-yet-admitted batches, summer terms, and filtered sections", () => {
    // OLD (2022) is in semester 10 of 8; NEW (2027) has not started.
    expect(planOfferings(inputs).some((p) => p.sectionId !== "A")).toBe(false);
    expect(planOfferings({ ...inputs, term: { ...inputs.term, kind: "summer" } })).toEqual([]);
    expect(planOfferings(inputs, () => false)).toEqual([]);
  });

  it("reports semesters a regulation leaves empty", () => {
    expect(emptySemesters(4, [1, 2, 4, 4])).toEqual([3]);
    expect(emptySemesters(2, [1, 2])).toEqual([]);
  });
});

describe("academic structure guards", () => {
  it("lets the principal manage everything, the HOD only their department", () => {
    expect(canManageTerms(ctxFor("principal"), demoTree)).toBe(true);
    expect(canManageAt(ctxFor("hod_cse"), demoTree, unit("CSE"))).toBe(true);
    expect(canManageAt(ctxFor("hod_cse"), demoTree, unit("ECE"))).toBe(false);
    expect(canManageTerms(ctxFor("hod_cse"), demoTree)).toBe(false);
    expect(canManageAt(ctxFor("faculty"), demoTree, unit("CSE-3-A"))).toBe(false);
  });

  it("limits allocation to teaching:allocate scope, with the delegation ceiling and no self-allocation", () => {
    const hod = ctxFor("hod_cse");
    const req = (section: string, target = "someone") => ({
      sectionId: unit(section),
      targetUserId: target,
      facultyPermissions: FACULTY_PERMS,
    });
    expect(canAllocate(hod, demoTree, req("CSE-3-C")).ok).toBe(true);
    expect(canAllocate(hod, demoTree, req("ECE-3-A")).ok).toBe(false);
    expect(canAllocate(hod, demoTree, req("CSE-3-C", hod.userId)).ok).toBe(false);
    // The programme coordinator can draft regulations but not hand out teaching access.
    expect(canAllocate(ctxFor("programme_coordinator"), demoTree, req("CSE-3-C")).ok).toBe(false);
    // A role lacking a permission the allocation would grant is stopped by the ceiling.
    const narrow = ctxFor("hod_cse");
    const stripped = {
      ...narrow,
      assignments: narrow.assignments.map((a) => ({
        ...a,
        permissions: new Set([...a.permissions].filter((p) => p !== "attendance:edit")),
      })),
    };
    const ceiling = canAllocate(stripped, demoTree, req("CSE-3-C"));
    expect(ceiling.ok).toBe(false);
    expect(!ceiling.ok && ceiling.reason).toMatch(/attendance:edit/);
  });

  it("shows faculty profiles by home department", () => {
    expect(canViewFacultyIn(ctxFor("hod_cse"), demoTree, unit("CSE"))).toBe(true);
    expect(canViewFacultyIn(ctxFor("hod_cse"), demoTree, unit("ECE"))).toBe(false);
    expect(canViewFacultyIn(ctxFor("director"), demoTree, unit("MBA"))).toBe(true);
    expect(canViewFacultyIn(ctxFor("faculty"), demoTree, unit("CSE"))).toBe(false);
    expect(canViewFacultyIn(ctxFor("finance"), demoTree, unit("CSE"))).toBe(false);
  });
});

describe("teaching-derived access", () => {
  it("groups allocations into one unit-scoped faculty assignment per section, in section-code order", () => {
    const derived = deriveTeachingAssignments(
      [
        { sectionId: "S1", sectionCode: "CSE-3-B", courseCode: "CS302" },
        { sectionId: "S2", sectionCode: "CSE-3-A", courseCode: "CS301" },
        { sectionId: "S2", sectionCode: "CSE-3-A", courseCode: "CS301L" },
      ],
      { key: "faculty", name: "Faculty", rank: 70, permissions: FACULTY_PERMS },
    );
    expect(derived.map((a) => [a.orgUnitId, a.courseCodes])).toEqual([
      ["S2", ["CS301", "CS301L"]],
      ["S1", ["CS302"]],
    ]);
    expect(derived.every((a) => a.scopeMode === "unit" && a.source === "teaching")).toBe(true);
  });

  it("gives the DBMS persona exactly the sections they teach, from allocation alone", () => {
    const ctx = ctxFor("faculty");
    expect(ctx.assignments.every((a) => a.source === "teaching")).toBe(true);
    expect(ctx.assignments.map((a) => [a.orgUnitId, a.courseCodes])).toEqual([
      ["CSE-3-A", ["CS301"]],
      ["CSE-3-B", ["CS301"]],
    ]);
  });
});

describe("student scope prefilter", () => {
  it("loads everything for institution-wide roles and only covered sections otherwise", () => {
    expect(studentScope(ctxFor("principal"), demoTree).all).toBe(true);
    const hod = studentScope(ctxFor("hod_cse"), demoTree);
    expect(hod.all).toBe(false);
    expect(hod.sectionIds).toHaveLength(12);
    expect(hod.sectionIds.every((id) => id.startsWith("CSE-"))).toBe(true);
    expect(studentScope(ctxFor("faculty"), demoTree).sectionIds).toEqual(["CSE-3-A", "CSE-3-B"]);
    const student = studentScope(ctxFor("student"), demoTree);
    expect(student).toMatchObject({ all: false, sectionIds: [] });
    expect(student.studentNumbers).toHaveLength(1);
  });

  it("round-trips through its cache key", () => {
    for (const key of ["principal", "hod_cse", "parent", "finance"]) {
      const scope = studentScope(ctxFor(key), demoTree);
      expect(parseScopeKey(scopeKey(scope))).toEqual(scope);
    }
  });
});

describe("synthetic academic data", () => {
  it("has one name and credit pattern per course code", () => {
    expect(new Set(COURSE_CATALOGUE.map((c) => c.code)).size).toBe(COURSE_CATALOGUE.length);
  });

  it("defines every semester of every published regulation", () => {
    for (const reg of REGULATIONS) {
      const p = PROGRAMMES.find((x) => x.code === reg.programmeCode)!;
      expect(
        emptySemesters(
          p.semesters,
          reg.courses.map((c) => c.semester),
        ),
        `${p.code} ${reg.code}`,
      ).toEqual([]);
    }
  });

  it("pins every batch to a regulation of its own programme", () => {
    for (const b of BATCHES)
      expect(
        REGULATIONS.some((r) => r.programmeCode === b.programmeCode && r.code === b.regulationCode),
      ).toBe(true);
  });

  it("offers each section the courses current students take, keeping deliberate gaps and loads near cap", () => {
    const plan = currentTermOfferings();
    const unallocated = plan.filter((o) => !o.facultyName).map((o) => `${o.sectionCode}/${o.courseCode}`);
    expect(unallocated.sort()).toEqual(["CSE-3-C/CS305", "ECE-2-B/EC203", "MECH-4-A/ME405"]);
    for (const s of STUDENTS.filter((x, i) => i % 37 === 0)) {
      const offered = plan.filter((o) => o.sectionCode === s.sectionId).map((o) => o.courseCode);
      expect(offered).toEqual(coursesFor(s.departmentCode, s.year).map((c) => c.code));
    }
    const hours = new Map<string, number>();
    const catalogue = new Map(COURSE_CATALOGUE.map((c) => [c.code, c]));
    for (const o of plan.filter((x) => x.facultyName)) {
      const c = catalogue.get(o.courseCode)!;
      hours.set(
        o.facultyName!,
        (hours.get(o.facultyName!) ?? 0) + c.lectureHours + c.tutorialHours + c.practicalHours,
      );
    }
    const over = FACULTY.filter((f) => (hours.get(f.name) ?? 0) > f.maxWeeklyHours);
    expect(over.map((f) => f.name)).toEqual([]);
  });
});

describe("database and fixture students agree", () => {
  it("builds the same Student from a record as the in-memory fixture", () => {
    const tallies = attendanceTallies();
    for (const fixture of STUDENTS.filter((_, i) => i % 41 === 0)) {
      const p = PROGRAMMES.find((x) => x.departmentCode === fixture.departmentCode)!;
      const admissionYear = Number(fixture.batch.slice(0, 4));
      const row: StudentRow = {
        id: fixture.id,
        studentNumber: fixture.studentNumber,
        name: fixture.name,
        gender: fixture.gender,
        email: fixture.email,
        phone: fixture.phone,
        status: fixture.status,
        admittedOn: fixture.admittedOn,
        hosteller: fixture.hosteller,
        sectionOrgId: "x",
        sectionCode: fixture.sectionId,
        sectionLabel: fixture.sectionLabel,
        departmentCode: fixture.departmentCode,
        programmeCode: p.code,
        programmeName: p.name,
        durationYears: p.durationYears,
        attendanceThresholdPct: PROGRAMME_THRESHOLDS[fixture.departmentCode] ?? null,
        batchCode: `${p.code}-${admissionYear}`,
        batchName: "",
        admissionYear,
        graduationYear: admissionYear + p.durationYears,
        curriculumId: "x",
        regulationCode: "R24",
        regulationName: "",
        mentorName: fixture.mentorName,
      };
      const built = buildStudent(
        row,
        {
          id: "t",
          code: "2026-27-ODD",
          name: "Odd semester 2026–27",
          kind: "odd",
          startsOn: "2026-07-01",
          endsOn: "2026-11-30",
          academicYearCode: "2026-27",
          academicYearStart: 2026,
        },
        coursesFor(fixture.departmentCode, fixture.year),
        fixture.guardian,
        tallies.get(fixture.studentNumber),
        ATTENDANCE_THRESHOLD,
        {
          ...standingFor(fixture.studentNumber),
          creditsRequired: creditsRequired(
            STUDENT_SPECS.find((x) => x.studentNumber === fixture.studentNumber)!,
          ),
        },
      );
      expect(built.student).toEqual(fixture);
    }
  });
});
