import type { StudentFieldAccess } from "@/lib/authz/engine";
import { eligibilityFor } from "@/domains/exams/rules";
import type { Student } from "./types";

/*
 * A plain-language summary of a student's record for Student 360 — written from the figures by rules, not generated,
 * and limited to the fields the viewer may read (a teacher with course-only access gets no cohort-wide sentence).
 */

export interface SummaryLine {
  tone: "good" | "watch" | "critical" | "neutral";
  text: string;
}

export function summarizeStudent(s: Student, access: StudentFieldAccess): SummaryLine[] {
  const first = s.name.split(" ")[0];
  const lines: SummaryLine[] = [
    {
      tone: s.status === "active" ? "neutral" : "watch",
      text: `${first} is in year ${s.year} of ${s.programme}, section ${s.sectionLabel}${s.status === "active" ? "" : ` (currently ${s.status.replace("_", " ")})`}.`,
    },
  ];
  if (access.academic) {
    const e = eligibilityFor(s.attendancePct, s.attendanceThreshold);
    lines.push(
      e === "eligible"
        ? {
            tone: s.attendancePct < s.attendanceThreshold + 5 ? "watch" : "good",
            text: `Attendance is ${s.attendancePct.toFixed(1)}%, above the ${s.attendanceThreshold}% requirement${s.attendancePct < s.attendanceThreshold + 5 ? " but with little margin" : ""}.`,
          }
        : e === "condonable"
          ? {
              tone: "watch",
              text: `Attendance is ${s.attendancePct.toFixed(1)}%, below the ${s.attendanceThreshold}% requirement: sitting the semester-end exams needs an approved condonation.`,
            }
          : {
              tone: "critical",
              text: `Attendance is ${s.attendancePct.toFixed(1)}%, below the condonation band: not eligible for the semester-end exams as things stand.`,
            },
    );
    if (s.cgpa > 0)
      lines.push({
        tone: s.backlogs >= 2 ? "critical" : s.backlogs === 1 || s.cgpa < 6 ? "watch" : "good",
        text: `CGPA ${s.cgpa.toFixed(2)} with ${s.creditsEarned} of ${s.creditsRequired} credits earned${s.backlogs ? ` and ${s.backlogs} active backlog${s.backlogs > 1 ? "s" : ""}` : " and no backlogs"}.`,
      });
  }
  if (access.risk)
    lines.push(
      s.risk.level === "none"
        ? { tone: "good", text: "No risk factor is flagged." }
        : {
            tone: s.risk.level === "high" ? "critical" : "watch",
            text: `${s.risk.level === "high" ? "High risk" : "On watch"}: ${s.risk.factors.map((f) => f.label.toLowerCase()).join(", ")}.`,
          },
    );
  return lines;
}
