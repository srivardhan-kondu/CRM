import { describe, expect, it } from "vitest";
import {
  applyFilters,
  columnsFor,
  paginate,
  queryVisible,
  sortRows,
  summarize,
} from "@/domains/students/query";
import { ATTENDANCE_THRESHOLD, STUDENTS } from "@/lib/demo/fixtures";
import { ctxFor, visibleFor } from "../helpers/demo-authz";

describe("student query over visible rows", () => {
  it("cannot be widened by filters — a CSE HOD filtering for ECE gets nothing", () => {
    expect(queryVisible(visibleFor(ctxFor("hod_cse")), { department: "ECE" }).total).toBe(0);
  });

  it("cannot be widened by text search for an out-of-scope student", () => {
    const ece = STUDENTS.find((s) => s.departmentCode === "ECE")!;
    expect(queryVisible(visibleFor(ctxFor("class_incharge")), { q: ece.studentNumber }).total).toBe(0);
  });

  it("never matches a field filter on rows where the field is hidden", () => {
    // Faculty cannot read academics: a shortage filter must return nothing rather than leak who is short.
    expect(applyFilters(visibleFor(ctxFor("faculty")), { shortage: true })).toHaveLength(0);
    // The HOD cannot read fees: a fee filter matches nobody.
    expect(applyFilters(visibleFor(ctxFor("hod_cse")), { fee: "overdue" })).toHaveLength(0);
  });

  it("filters shortage strictly below the threshold where readable", () => {
    const rows = applyFilters(visibleFor(ctxFor("principal")), { shortage: true });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.student.attendancePct < r.student.attendanceThreshold)).toBe(true);
    // Programme thresholds apply: MBA students are measured against 80%, not the institution default.
    expect(rows.some((r) => r.student.attendanceThreshold !== ATTENDANCE_THRESHOLD)).toBe(true);
  });

  it("ignores sorting by a hidden field (order would leak it)", () => {
    const rows = visibleFor(ctxFor("faculty"));
    const sorted = sortRows(rows, "attendance", "asc").map((r) => r.student.studentNumber);
    expect(sorted).toEqual([...sorted].sort());
  });

  it("sorts by attendance when readable", () => {
    const asc = sortRows(visibleFor(ctxFor("principal")), "attendance", "asc");
    expect(asc[0]!.student.attendancePct).toBeLessThanOrEqual(asc.at(-1)!.student.attendancePct);
  });

  it("paginates server-side and clamps out-of-range pages and sizes", () => {
    const rows = Array.from({ length: 53 }, (_, i) => i);
    expect(paginate(rows, 3, 25)).toMatchObject({ rows: [50, 51, 52], page: 3, pageCount: 3, total: 53 });
    expect(paginate(rows, 99, 25).page).toBe(3);
    expect(paginate(rows, 0, 25).page).toBe(1);
    expect(paginate(rows, 1, 10_000).pageSize).toBe(100);
  });

  it("shows a column only when some row exposes it", () => {
    expect(columnsFor(visibleFor(ctxFor("faculty")))).toEqual({
      academic: false,
      risk: false,
      finance: false,
      contact: false,
    });
    expect(columnsFor(visibleFor(ctxFor("hod_cse")))).toMatchObject({ academic: true, finance: false });
    expect(columnsFor(visibleFor(ctxFor("class_incharge")))).toMatchObject({ academic: true, risk: true });
  });

  it("summarises only readable values", () => {
    const hod = summarize(visibleFor(ctxFor("hod_cse")));
    expect(hod.financeCount).toBe(0);
    expect(hod.feeOverdue).toBe(0);
    const ci = visibleFor(ctxFor("class_incharge"));
    const sum = summarize(ci);
    expect(sum.total).toBe(ci.length);
    expect(sum.academicCount).toBe(ci.filter((r) => r.student.sectionId === "CSE-3-A").length);
  });
});

describe("synthetic fixtures", () => {
  it("use unique student numbers and ids", () => {
    expect(new Set(STUDENTS.map((s) => s.studentNumber)).size).toBe(STUDENTS.length);
    expect(new Set(STUDENTS.map((s) => s.id)).size).toBe(STUDENTS.length);
  });

  it("explain every flagged student with at least one factor", () => {
    for (const s of STUDENTS) {
      if (s.risk.level !== "none" && s.attendancePct >= 65) expect(s.risk.factors.length).toBeGreaterThan(0);
    }
  });
});
