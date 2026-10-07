import type { StudentFieldAccess } from "@/lib/authz/engine";
import type { Page, Student, StudentQuery } from "./types";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** A student the viewer may open, paired with the fields they may read on that specific record. */
export interface Visible {
  student: Student;
  access: StudentFieldAccess;
}

function matchesText(s: Student, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    s.name.toLowerCase().includes(needle) ||
    s.studentNumber.toLowerCase().includes(needle) ||
    s.sectionLabel.toLowerCase().includes(needle) ||
    s.email.toLowerCase().includes(needle)
  );
}

/**
 * Filters are evaluated per row against that row's field access: a filter on a field the viewer cannot read
 * for a given student never matches it. Filtering therefore cannot be used to infer hidden values.
 */
export function applyFilters(rows: readonly Visible[], query: StudentQuery): Visible[] {
  return rows.filter(({ student: s, access }) => {
    if (query.q && !matchesText(s, query.q)) return false;
    if (query.department && s.departmentCode !== query.department) return false;
    if (query.year && s.year !== query.year) return false;
    if (query.sectionId && s.sectionId !== query.sectionId) return false;
    if (query.risk && query.risk !== "any" && (!access.risk || s.risk.level !== query.risk)) return false;
    if (query.fee && (!access.finance || s.feeStatus !== query.fee)) return false;
    if (query.shortage && (!access.academic || s.attendancePct >= s.attendanceThreshold)) return false;
    return true;
  });
}

/** Sorting by a field is only honoured when that field is readable on every row; otherwise order would leak it. */
export function sortRows(
  rows: Visible[],
  sort: StudentQuery["sort"] = "number",
  dir: StudentQuery["dir"] = "asc",
) {
  const needsAcademic = sort === "attendance" || sort === "cgpa";
  const effective = needsAcademic && !rows.every((r) => r.access.academic) ? "number" : sort;
  const factor = dir === "desc" ? -1 : 1;
  const cmp: Record<NonNullable<StudentQuery["sort"]>, (a: Student, b: Student) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    number: (a, b) => a.studentNumber.localeCompare(b.studentNumber),
    attendance: (a, b) => a.attendancePct - b.attendancePct,
    cgpa: (a, b) => a.cgpa - b.cgpa,
  };
  return [...rows].sort(
    (a, b) =>
      cmp[effective](a.student, b.student) * factor ||
      a.student.studentNumber.localeCompare(b.student.studentNumber),
  );
}

export function paginate<T>(rows: T[], page = 1, pageSize = DEFAULT_PAGE_SIZE): Page<T> {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  return {
    rows: rows.slice((current - 1) * size, current * size),
    total: rows.length,
    page: current,
    pageSize: size,
    pageCount,
  };
}

export function queryVisible(rows: readonly Visible[], query: StudentQuery): Page<Visible> {
  return paginate(sortRows(applyFilters(rows, query), query.sort, query.dir), query.page, query.pageSize);
}

/** Which columns to render: a field class is shown if it is readable on at least one visible row. */
export function columnsFor(rows: readonly Visible[]) {
  return {
    academic: rows.some((r) => r.access.academic),
    risk: rows.some((r) => r.access.risk),
    finance: rows.some((r) => r.access.finance),
    contact: rows.some((r) => r.access.contact),
  };
}

export interface CohortSummary {
  total: number;
  active: number;
  /** Metrics below are computed only over rows where the underlying field is readable. */
  academicCount: number;
  avgAttendance: number;
  shortage: number;
  avgCgpa: number;
  riskCount: number;
  highRisk: number;
  watch: number;
  financeCount: number;
  feeOverdue: number;
  feeOutstanding: number;
}

export function summarize(rows: readonly Visible[]): CohortSummary {
  const academic = rows.filter((r) => r.access.academic).map((r) => r.student);
  const risk = rows.filter((r) => r.access.risk).map((r) => r.student);
  const finance = rows.filter((r) => r.access.finance).map((r) => r.student);
  const graded = academic.filter((s) => s.cgpa > 0);
  return {
    total: rows.length,
    active: rows.filter((r) => r.student.status === "active").length,
    academicCount: academic.length,
    avgAttendance: academic.length ? academic.reduce((n, s) => n + s.attendancePct, 0) / academic.length : 0,
    shortage: academic.filter((s) => s.attendancePct < s.attendanceThreshold).length,
    avgCgpa: graded.length ? graded.reduce((n, s) => n + s.cgpa, 0) / graded.length : 0,
    riskCount: risk.length,
    highRisk: risk.filter((s) => s.risk.level === "high").length,
    watch: risk.filter((s) => s.risk.level === "watch").length,
    financeCount: finance.length,
    feeOverdue: finance.filter((s) => s.feeStatus === "overdue").length,
    feeOutstanding: finance.reduce((n, s) => n + s.feeDue, 0),
  };
}

export function groupBy<K extends string, T>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}
