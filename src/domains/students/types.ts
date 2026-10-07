export type StudentStatus = "active" | "on_leave" | "detained" | "graduated" | "withdrawn";
export type FeeStatus = "paid" | "due" | "overdue";
export type RiskLevel = "none" | "watch" | "high";

export interface RiskFactor {
  key: "attendance" | "academic" | "backlogs";
  label: string;
  detail: string;
  /** Threshold definition shown alongside the factor so the signal is never a black box. */
  threshold: string;
}

export interface Guardian {
  name: string;
  relation: "Father" | "Mother" | "Guardian";
  phone: string;
}

/** Term-to-date attendance in one course. `held` excludes medically excused classes; `attended` includes OD. */
export interface SubjectAttendance {
  courseCode: string;
  courseName: string;
  attended: number;
  held: number;
  od: number;
  excused: number;
}

export interface TimelineEvent {
  id: string;
  at: string;
  kind: "enrollment" | "fee" | "attendance" | "mentoring" | "academic" | "notice";
  title: string;
  detail: string;
}

export interface Student {
  id: string;
  studentNumber: string;
  name: string;
  gender: "F" | "M" | "X";
  email: string;
  phone: string;
  /** Org unit code of the programme's department: "CSE". */
  departmentCode: string;
  programme: string;
  batch: string;
  year: number;
  semester: number;
  sectionId: string;
  sectionLabel: string;
  status: StudentStatus;
  attendancePct: number;
  /** The programme's shortage threshold (institution default unless the programme overrides it). */
  attendanceThreshold: number;
  cgpa: number;
  backlogs: number;
  creditsEarned: number;
  creditsRequired: number;
  feeStatus: FeeStatus;
  feeDue: number;
  mentorName: string;
  hosteller: boolean;
  admittedOn: string;
  guardian: Guardian;
  risk: { level: RiskLevel; factors: RiskFactor[] };
}

export type StudentSort = "name" | "number" | "attendance" | "cgpa";

export interface StudentQuery {
  q?: string;
  department?: string;
  year?: number;
  sectionId?: string;
  risk?: RiskLevel | "any";
  fee?: FeeStatus;
  shortage?: boolean;
  sort?: StudentSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
