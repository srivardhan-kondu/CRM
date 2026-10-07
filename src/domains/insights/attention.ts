/*
 * The attention model every dashboard follows: critical issues, then action required, then important, then general
 * information. Pure, so ranking and the campus-pulse verdict are unit-tested and explainable — each item carries the
 * rule that raised it.
 */

export type Priority = "critical" | "action" | "important" | "info";

export const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, action: 1, important: 2, info: 3 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Urgent",
  action: "To do",
  important: "Important",
  info: "For your information",
};

export interface AttentionItem {
  id: string;
  priority: Priority;
  title: string;
  /** Why this was raised, with the figures — never just a number. */
  detail: string;
  href: string;
  /** Verb for the link: "Review", "Mark now", "Acknowledge"… */
  cta: string;
  count?: number;
}

export function rankAttention(items: readonly AttentionItem[]): AttentionItem[] {
  return [...items].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (b.count ?? 0) - (a.count ?? 0),
  );
}

export type Health = "good" | "watch" | "critical";

export interface Vital {
  key: string;
  label: string;
  value: string;
  status: Health;
  /** One line that explains the status, including the threshold it is judged against. */
  note: string;
  href?: string;
}

export interface Pulse {
  status: Health;
  headline: string;
  vitals: Vital[];
}

export interface PulseInput {
  scopeName: string;
  students: number;
  avgAttendance: number;
  threshold: number;
  /** Below the threshold (needs condonation or is not eligible). */
  shortage: number;
  /** Below the condonation band: cannot sit the semester-end examinations as things stand. */
  notEligible: number;
  highRisk: number;
  approvalsPending: number;
  approvalsOverdue: number;
  /** Change in weekly attendance against the previous week, in points (null without two weeks of data). */
  attendanceDelta: number | null;
}

const pct = (n: number, of: number) => (of === 0 ? 0 : (n / of) * 100);

/**
 * Campus health in one verdict. Critical when students are already ineligible for examinations above 2% of the cohort,
 * or approvals are past their SLA; on watch when average attendance is within 5 points of the threshold, shortage
 * exceeds 10% of students or more than 3% are high risk; good otherwise.
 */
export function campusPulse(p: PulseInput): Pulse {
  const ineligibleShare = pct(p.notEligible, p.students);
  const shortageShare = pct(p.shortage, p.students);
  const riskShare = pct(p.highRisk, p.students);
  const vitals: Vital[] = [
    {
      key: "attendance",
      label: "Average attendance",
      value: `${p.avgAttendance.toFixed(1)}%`,
      status:
        p.avgAttendance < p.threshold ? "critical" : p.avgAttendance < p.threshold + 5 ? "watch" : "good",
      note:
        p.attendanceDelta === null || Math.abs(p.attendanceDelta) < 0.05
          ? `Needs to be ${p.threshold}% or more`
          : `${p.attendanceDelta > 0 ? "Up" : "Down"} ${Math.abs(p.attendanceDelta).toFixed(1)} from last week · needs ${p.threshold}%`,
    },
    {
      key: "eligibility",
      label: "Can sit the exams",
      value: `${(100 - shortageShare).toFixed(0)}%`,
      status: ineligibleShare > 2 ? "critical" : shortageShare > 10 ? "watch" : "good",
      note: p.shortage
        ? `${p.shortage} below ${p.threshold}% attendance, ${p.notEligible} of them too far below`
        : "Every student has enough attendance",
    },
    {
      key: "risk",
      label: "Students who need help",
      value: String(p.highRisk),
      status: riskShare > 3 ? "watch" : "good",
      note: `${riskShare.toFixed(0)}% of ${p.students} students`,
    },
    {
      key: "operations",
      label: "Waiting for your decision",
      value: String(p.approvalsPending),
      status: p.approvalsOverdue > 0 ? "critical" : p.approvalsPending > 5 ? "watch" : "good",
      note: p.approvalsOverdue ? `${p.approvalsOverdue} overdue` : "Nothing overdue",
    },
  ];
  const status: Health = vitals.some((v) => v.status === "critical")
    ? "critical"
    : vitals.some((v) => v.status === "watch")
      ? "watch"
      : "good";
  const reasons: string[] = [];
  if (p.notEligible > 0)
    reasons.push(
      `${p.notEligible} student${p.notEligible === 1 ? " is" : "s are"} too far below the attendance needed to sit exams`,
    );
  else if (shortageShare > 10) reasons.push(`${p.shortage} students are below ${p.threshold}% attendance`);
  if (p.approvalsOverdue > 0)
    reasons.push(
      `${p.approvalsOverdue} request${p.approvalsOverdue === 1 ? " is" : "s are"} overdue for a decision`,
    );
  if (p.avgAttendance < p.threshold + 5)
    reasons.push(`average attendance is only ${p.avgAttendance.toFixed(1)}%`);
  if (riskShare > 3) reasons.push(`${p.highRisk} students need help`);
  const headline =
    status === "good"
      ? `Everything looks fine ${p.scopeName === "The campus" ? "across the campus" : `in ${p.scopeName}`}.`
      : `${p.scopeName} ${status === "critical" ? "needs your attention" : "needs a closer look"}: ${reasons.join(", and ")}.`;
  return { status, headline, vitals };
}

/** Weekly series → current value and change against the previous point. */
export function trendSummary(points: readonly { value: number }[]): {
  current: number | null;
  delta: number | null;
} {
  const last = points.at(-1);
  const prev = points.at(-2);
  return {
    current: last ? last.value : null,
    delta: last && prev ? last.value - prev.value : null,
  };
}
