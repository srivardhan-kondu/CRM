/*
 * The attention model every dashboard follows: critical issues, then action required, then important, then general
 * information. Pure, so ranking and the campus-pulse verdict are unit-tested and explainable — each item carries the
 * rule that raised it.
 */

export type Priority = "critical" | "action" | "important" | "info";

export const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, action: 1, important: 2, info: 3 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Critical",
  action: "Action required",
  important: "Important",
  info: "For information",
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
      label: "Attendance",
      value: `${p.avgAttendance.toFixed(1)}%`,
      status:
        p.avgAttendance < p.threshold ? "critical" : p.avgAttendance < p.threshold + 5 ? "watch" : "good",
      note:
        p.attendanceDelta === null
          ? `Average against the ${p.threshold}% requirement`
          : `${p.attendanceDelta >= 0 ? "Up" : "Down"} ${Math.abs(p.attendanceDelta).toFixed(1)} pts on last week · requirement ${p.threshold}%`,
    },
    {
      key: "eligibility",
      label: "Exam eligibility",
      value: `${(100 - shortageShare).toFixed(0)}%`,
      status: ineligibleShare > 2 ? "critical" : shortageShare > 10 ? "watch" : "good",
      note: p.shortage
        ? `${p.shortage} below the requirement, ${p.notEligible} past the condonation band`
        : "Every student meets the attendance requirement",
    },
    {
      key: "risk",
      label: "Students at risk",
      value: String(p.highRisk),
      status: riskShare > 3 ? "watch" : "good",
      note: `${riskShare.toFixed(1)}% of ${p.students} students are high risk`,
    },
    {
      key: "operations",
      label: "Decisions waiting",
      value: String(p.approvalsPending),
      status: p.approvalsOverdue > 0 ? "critical" : p.approvalsPending > 5 ? "watch" : "good",
      note: p.approvalsOverdue ? `${p.approvalsOverdue} past the SLA` : "None past the SLA",
    },
  ];
  const status: Health = vitals.some((v) => v.status === "critical")
    ? "critical"
    : vitals.some((v) => v.status === "watch")
      ? "watch"
      : "good";
  const worst = vitals.filter((v) => v.status === status && status !== "good");
  const headline =
    status === "good"
      ? `${p.scopeName} is in good health.`
      : `${p.scopeName} ${status === "critical" ? "needs attention" : "is on watch"}: ${worst.map((v) => v.note.charAt(0).toLowerCase() + v.note.slice(1)).join("; ")}.`;
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
