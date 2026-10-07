import type { StudentFieldAccess } from "@/lib/authz/engine";
import type {
  FeeStatus,
  RiskFactor,
  RiskLevel,
  Student,
  StudentStatus,
  SubjectAttendance,
  TimelineEvent,
} from "./types";

type FieldFlag = "always" | "academic" | "risk" | "finance";

const TIMELINE_FIELD: Record<TimelineEvent["kind"], FieldFlag> = {
  enrollment: "always",
  notice: "always",
  attendance: "academic",
  academic: "academic",
  mentoring: "risk",
  fee: "finance",
};

/** Timeline entries inherit the sensitivity of the domain they come from. */
export function visibleTimeline(events: TimelineEvent[], access: StudentFieldAccess): TimelineEvent[] {
  return events.filter((e) => {
    const f = TIMELINE_FIELD[e.kind];
    return f === "always" || access[f];
  });
}

/** Subject attendance limited to what the viewer may read: all subjects, or only their teaching courses. */
export function visibleSubjects(
  subjects: SubjectAttendance[],
  access: StudentFieldAccess,
): SubjectAttendance[] {
  if (access.courseAttendance === "all") return subjects;
  const allowed = new Set(access.courseAttendance);
  return subjects.filter((s) => allowed.has(s.courseCode));
}

/**
 * Client-safe projection of a student for list views. Fields the viewer may not read are omitted here, on the
 * server, so they never reach the browser — hiding a column in the UI is not the security boundary.
 */
export interface StudentRow {
  id: string;
  studentNumber: string;
  name: string;
  programme: string;
  sectionLabel: string;
  year: number;
  semester: number;
  status: StudentStatus;
  mentorName: string;
  attendancePct?: number;
  attendanceThreshold?: number;
  cgpa?: number;
  backlogs?: number;
  creditsEarned?: number;
  creditsRequired?: number;
  risk?: { level: RiskLevel; factors: RiskFactor[] };
  feeStatus?: FeeStatus;
  feeDue?: number;
  email?: string;
  phone?: string;
}

export function toStudentRow(s: Student, access: StudentFieldAccess): StudentRow {
  return {
    id: s.id,
    studentNumber: s.studentNumber,
    name: s.name,
    programme: s.programme,
    sectionLabel: s.sectionLabel,
    year: s.year,
    semester: s.semester,
    status: s.status,
    mentorName: s.mentorName,
    ...(access.academic && {
      attendancePct: s.attendancePct,
      attendanceThreshold: s.attendanceThreshold,
      cgpa: s.cgpa,
      backlogs: s.backlogs,
      creditsEarned: s.creditsEarned,
      creditsRequired: s.creditsRequired,
    }),
    ...(access.risk && { risk: s.risk }),
    ...(access.finance && { feeStatus: s.feeStatus, feeDue: s.feeDue }),
    ...(access.contact && { email: s.email, phone: s.phone }),
  };
}
