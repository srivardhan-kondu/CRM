import { eligibilityFor } from "@/domains/exams/rules";
import { RECONTACT_AFTER_DAYS, type TemplateKey } from "./templates";

/*
 * Follow-ups the data suggests (the hub's "intelligence", deliberately rule-based and explainable): guardians of a
 * student below the attendance requirement who have not been told in the last fortnight. The reason shown is the rule
 * that fired, with the student's own figures.
 */

export interface FollowUp {
  template: TemplateKey;
  reason: string;
  severity: "high" | "critical";
}

const DAY = 24 * 60 * 60 * 1000;

export function suggestFollowUp(
  student: { attendancePct: number; attendanceThreshold: number; status: string },
  lastContactedAt: string | null,
  now: Date,
): FollowUp | null {
  if (student.status !== "active") return null;
  const eligibility = eligibilityFor(student.attendancePct, student.attendanceThreshold);
  if (eligibility === "eligible") return null;
  if (lastContactedAt && now.getTime() - new Date(lastContactedAt).getTime() < RECONTACT_AFTER_DAYS * DAY)
    return null;
  const pct = student.attendancePct.toFixed(1);
  return eligibility === "condonable"
    ? {
        template: "attendance_shortage",
        severity: "high",
        reason: `${pct}% against ${student.attendanceThreshold}% — needs condonation to sit the semester-end exams`,
      }
    : {
        template: "exam_eligibility",
        severity: "critical",
        reason: `${pct}% — below the condonation band, not eligible for the semester-end exams as things stand`,
      };
}
