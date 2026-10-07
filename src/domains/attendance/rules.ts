import type { LocalNow } from "./calendar";

/*
 * Attendance rules (decided with the product owner, ADR-019). Pure, so the database aggregate, the in-memory
 * twin and the screens all apply the same arithmetic.
 *
 *  - Faculty mark each student present or absent. That mark is never rewritten by leave.
 *  - Approved on-duty (OD) leave turns an absence into attendance; approved medical leave removes the class from
 *    the student's denominator. Leave is applied when attendance is read, so a leave approved after the class was
 *    marked still counts. When both cover a day, OD wins (it is the more favourable reading).
 *  - The shortage threshold is per programme, defaulting to the institution's (75%).
 *  - Marking and changing a session is open only on the session's own day, from its start time. Afterwards every
 *    change is a request that someone else approves.
 */

export type Mark = "present" | "absent";
export type LeaveKind = "od" | "medical";
/** How a mark counts once approved leave is applied. */
export type Effective = "present" | "absent" | "od" | "excused";

export const DEFAULT_THRESHOLD_PCT = 75;

export function effectiveStatus(mark: Mark, leave: LeaveKind | null): Effective {
  if (mark === "present") return "present";
  if (leave === "od") return "od";
  if (leave === "medical") return "excused";
  return "absent";
}

export interface LeaveSpan {
  kind: LeaveKind;
  fromDate: string;
  toDate: string;
}

/** The approved leave covering a date, OD first; null when none does. */
export function leaveOn(leaves: readonly LeaveSpan[], date: string): LeaveKind | null {
  let found: LeaveKind | null = null;
  for (const l of leaves) {
    if (date < l.fromDate || date > l.toDate) continue;
    if (l.kind === "od") return "od";
    found = "medical";
  }
  return found;
}

/** Counts behind one percentage. `held` excludes medically excused classes; `attended` includes OD. */
export interface Tally {
  held: number;
  attended: number;
  od: number;
  excused: number;
}

export const emptyTally = (): Tally => ({ held: 0, attended: 0, od: 0, excused: 0 });

export function addEffective(t: Tally, e: Effective): Tally {
  if (e === "excused") t.excused += 1;
  else {
    t.held += 1;
    if (e === "present") t.attended += 1;
    if (e === "od") {
      t.attended += 1;
      t.od += 1;
    }
  }
  return t;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Attendance % to one decimal; 100 before any class has been held (nothing missed yet). */
export function percentOf(t: Pick<Tally, "held" | "attended">): number {
  return t.held > 0 ? round1((t.attended / t.held) * 100) : 100;
}

export function sumTallies(list: readonly Tally[]): Tally {
  return list.reduce(
    (acc, t) => ({
      held: acc.held + t.held,
      attended: acc.attended + t.attended,
      od: acc.od + t.od,
      excused: acc.excused + t.excused,
    }),
    emptyTally(),
  );
}

export const isShort = (pct: number, thresholdPct: number) => pct < thresholdPct;

/* ---------- Marking window ---------- */

/**
 * `open`: today and started — mark or change directly. `upcoming`: not started yet. `closed`: an earlier day —
 * changes go through an approved request (a correction, or a late submission when it was never marked).
 */
export type MarkingWindow = "open" | "upcoming" | "closed";

export function markingWindow(session: { date: string; startsAt: string }, now: LocalNow): MarkingWindow {
  if (session.date < now.date) return "closed";
  if (session.date > now.date || session.startsAt > now.time) return "upcoming";
  return "open";
}

/* ---------- Requests ---------- */

export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type AttendanceRequestKind = "correction" | "late_submission";

/** Hours an approver has before a request counts as overdue. */
export const SLA_HOURS: Record<AttendanceRequestKind | LeaveKind, number> = {
  correction: 48,
  late_submission: 48,
  od: 24,
  medical: 24,
};

export function dueAt(requestedAt: Date, kind: AttendanceRequestKind | LeaveKind): Date {
  return new Date(requestedAt.getTime() + SLA_HOURS[kind] * 3_600_000);
}

/** Changes a correction proposes against the current marks, for the approver to review. */
export function markChanges(
  current: ReadonlyMap<string, Mark>,
  proposed: Readonly<Record<string, Mark>>,
): { studentId: string; from: Mark | null; to: Mark }[] {
  return Object.entries(proposed)
    .filter(([id, to]) => current.get(id) !== to)
    .map(([studentId, to]) => ({ studentId, from: current.get(studentId) ?? null, to }));
}

/** Leave validation window: back-dated up to 14 days (illness is reported on return), ahead up to 60. */
export const LEAVE_BACKDATE_DAYS = 14;
export const LEAVE_AHEAD_DAYS = 60;
export const LEAVE_MAX_DAYS = 15;
