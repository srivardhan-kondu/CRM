export type DepartmentCode = "CSE" | "ECE" | "EEE" | "MECH" | "MBA" | "MCA";

export interface Campus {
  id: string;
  name: string;
}

export interface School {
  id: string;
  name: string;
  campusId: string;
}

export interface Department {
  code: DepartmentCode;
  name: string;
  schoolId: string;
  programme: string;
  /** Number of programme years (B.Tech = 4, MBA/MCA = 2). */
  years: number;
  sections: string[];
}

export interface Section {
  /** Stable key, e.g. "CSE-3-A" (department-year-section). */
  id: string;
  departmentCode: DepartmentCode;
  year: number;
  letter: string;
  /** Human label, e.g. "3-CSE-A". */
  label: string;
  batch: string;
}

export interface AcademicContext {
  institution: string;
  /** "2026–27" */
  academicYear: string;
  /** "Odd semester 2026–27" */
  term: string;
}
