import "server-only";

import { cache } from "react";
import { getDb } from "@/db/client";
import { getCurrentTerm } from "@/domains/academics/context";
import { loadOfferings } from "@/domains/academics/load";
import type { OfferingRow } from "@/domains/academics/load";
import { studentRef, subjectsFor, visibleStudents } from "@/domains/students/repository";
import type { Visible } from "@/domains/students/query";
import type { Authed } from "@/lib/authz/context";
import { holdsAnywhere, studentFieldAccess } from "@/lib/authz/engine";
import { institutionNow, institutionToday } from "@/lib/clock";
import { addDays, localInstant, type LocalNow } from "./calendar";
import {
  canApproveAttendanceIn,
  canDecideLeaveIn,
  canMarkCourse,
  canRequestLeaveFor,
  canViewSectionAttendance,
} from "./guards";
import {
  loadHolidays,
  loadLeaves,
  loadPolicy,
  loadRequests,
  loadRoll,
  loadSessionMarks,
  loadSessions,
  loadSlots,
  loadStudentLog,
  type LeaveRow,
  type RequestRow,
  type SessionRow,
} from "./load";
import { dueAt, markChanges, markingWindow, type MarkingWindow, type Mark } from "./rules";
import { occurrences, sessionKey, unmarked, type Occurrence } from "./schedule";

/*
 * Attendance reads for the screens, cached per request. Every function takes the authenticated context and applies
 * the attendance guards; what a page receives is already limited to what the viewer may see or do.
 */

const db = () => getDb();

const slotsFor = cache((tenantId: string, termId: string) => loadSlots(db(), tenantId, termId));
const holidaysFor = cache((tenantId: string, from: string, to: string) =>
  loadHolidays(db(), tenantId, from, to),
);
const policyFor = cache((tenantId: string) => loadPolicy(db(), tenantId));
const pendingRequests = cache((tenantId: string) => loadRequests(db(), tenantId, { status: "pending" }));
const pendingLeaves = cache((tenantId: string) => loadLeaves(db(), tenantId, { status: "pending" }));
const allOfferings = cache((tenantId: string, termId: string) => loadOfferings(db(), tenantId, termId));

export interface AttendanceContext {
  term: NonNullable<Awaited<ReturnType<typeof getCurrentTerm>>>;
  now: LocalNow;
  offerings: Map<string, OfferingRow>;
  holidays: { id: string; date: string; name: string }[];
  holidayDates: Set<string>;
  thresholdPct: number;
}

/**
 * The current term with its offerings, holidays and the institution's "now". Null without a current term. Cached per
 * request by tenant: `Authed` is a fresh object on every requireAuth() call, so it cannot be the cache key.
 */
const contextFor = cache(async (tenantId: string): Promise<AttendanceContext | null> => {
  const term = await getCurrentTerm(tenantId);
  if (!term) return null;
  const [offerings, holidays, policy] = await Promise.all([
    allOfferings(tenantId, term.id),
    holidaysFor(tenantId, term.startsOn, term.endsOn),
    policyFor(tenantId),
  ]);
  return {
    term,
    now: institutionToday(),
    offerings: new Map(offerings.map((o) => [o.id, o])),
    holidays,
    holidayDates: new Set(holidays.map((h) => h.date)),
    thresholdPct: policy.thresholdPct,
  };
});

export function attendanceContext(authed: Authed): Promise<AttendanceContext | null> {
  return contextFor(authed.ctx.tenantId);
}

/* ---------- Classes ---------- */

export interface ClassOccurrence extends Occurrence {
  key: string;
  courseCode: string;
  courseName: string;
  sectionId: string;
  sectionCode: string;
  sectionLabel: string;
  teachers: string[];
  window: MarkingWindow;
  recorded: Pick<SessionRow, "status" | "present" | "absent" | "markedBy" | "cancelReason"> | null;
  pendingRequestId: string | null;
  canMark: boolean;
}

/** Offerings the viewer teaches this term (active allocation). */
function taughtBy(c: AttendanceContext, userId: string): OfferingRow[] {
  return [...c.offerings.values()].filter((o) => o.allocations.some((a) => a.userId === userId));
}

async function decorate(
  authed: Authed,
  c: AttendanceContext,
  list: Occurrence[],
): Promise<ClassOccurrence[]> {
  if (list.length === 0) return [];
  const offeringIds = [...new Set(list.map((o) => o.offeringId))];
  const dates = list.map((o) => o.date).sort();
  const [sessions, requests] = await Promise.all([
    loadSessions(db(), authed.ctx.tenantId, { offeringIds, from: dates[0], to: dates.at(-1) }),
    pendingRequests(authed.ctx.tenantId),
  ]);
  const recorded = new Map(sessions.map((s) => [sessionKey(s), s]));
  const pending = new Map(requests.map((r) => [sessionKey(r), r.id]));
  return list.map((o) => {
    const offering = c.offerings.get(o.offeringId)!;
    const key = sessionKey(o);
    return {
      ...o,
      key,
      courseCode: offering.courseCode,
      courseName: offering.courseName,
      sectionId: offering.sectionId,
      sectionCode: offering.sectionCode,
      sectionLabel: offering.sectionLabel,
      teachers: offering.allocations.map((a) => a.name),
      window: markingWindow(o, c.now),
      recorded: recorded.get(key) ?? null,
      pendingRequestId: pending.get(key) ?? null,
      canMark: canMarkCourse(authed.ctx, authed.tree, offering.sectionId, offering.courseCode),
    };
  });
}

/** A day's timetabled classes for the viewer's teaching, or for one section (class incharge, student). */
export async function classesOn(
  authed: Authed,
  scope: { mine: true } | { sectionCode: string },
  date?: string,
): Promise<{ date: string; classes: ClassOccurrence[]; holiday: string | null } | null> {
  const c = await attendanceContext(authed);
  if (!c) return null;
  const day = date ?? c.now.date;
  const offerings =
    "mine" in scope
      ? taughtBy(c, authed.ctx.userId)
      : [...c.offerings.values()].filter((o) => o.sectionCode === scope.sectionCode);
  const ids = new Set(offerings.map((o) => o.id));
  const slots = (await slotsFor(authed.ctx.tenantId, c.term.id)).filter((s) => ids.has(s.offeringId));
  const holiday = c.holidays.find((h) => h.date === day)?.name ?? null;
  return {
    date: day,
    holiday,
    classes: await decorate(authed, c, occurrences(slots, c.holidayDates, day, day)),
  };
}

/**
 * The viewer's teaching that needs attendance: classes running now or finished today and still unmarked, earlier
 * classes never marked (each needs a late submission), and late submissions waiting for approval.
 */
export async function myOpenSessions(authed: Authed) {
  // Only teaching allocations make a user responsible for classes; skip the lookup for everyone else.
  if (!authed.ctx.assignments.some((a) => a.source === "teaching")) return null;
  const c = await attendanceContext(authed);
  if (!c) return null;
  const mine = taughtBy(c, authed.ctx.userId);
  if (mine.length === 0) return { now: c.now, markNow: [], overdue: [], awaiting: [] };
  const ids = new Set(mine.map((o) => o.id));
  const slots = (await slotsFor(authed.ctx.tenantId, c.term.id)).filter((s) => ids.has(s.offeringId));
  const expected = occurrences(slots, c.holidayDates, c.term.startsOn, c.now.date);
  const sessions = await loadSessions(db(), authed.ctx.tenantId, { offeringIds: [...ids] });
  const missing = unmarked(expected, new Set(sessions.map(sessionKey))).filter(
    (o) => markingWindow(o, c.now) !== "upcoming",
  );
  const list = await decorate(authed, c, missing);
  return {
    now: c.now,
    markNow: list.filter((o) => o.window === "open"),
    overdue: list.filter((o) => o.window === "closed" && !o.pendingRequestId),
    awaiting: list.filter((o) => o.window === "closed" && o.pendingRequestId),
  };
}

/** Recorded sessions of an offering plus expected ones still unmarked, newest first — the course's register. */
export async function offeringRegister(authed: Authed, offeringId: string) {
  const c = await attendanceContext(authed);
  const offering = c?.offerings.get(offeringId);
  if (!c || !offering) return null;
  const slots = (await slotsFor(authed.ctx.tenantId, c.term.id)).filter((s) => s.offeringId === offeringId);
  const expected = occurrences(slots, c.holidayDates, c.term.startsOn, c.now.date);
  const sessions = await loadSessions(db(), authed.ctx.tenantId, { offeringIds: [offeringId] });
  const recordedKeys = new Set(sessions.map(sessionKey));
  const gaps = await decorate(
    authed,
    c,
    unmarked(expected, recordedKeys).filter((o) => markingWindow(o, c.now) !== "upcoming"),
  );
  return {
    now: c.now,
    sessions,
    unmarked: gaps,
    weekly: slots,
    canMark: canMarkCourse(authed.ctx, authed.tree, offering.sectionId, offering.courseCode),
  };
}

/* ---------- One session ---------- */

export interface RollEntry {
  studentId: string;
  studentNumber: string;
  name: string;
  status: string;
  mark: Mark | null;
  leave: { kind: "od" | "medical"; status: "approved" | "pending" } | null;
}

/**
 * Everything the marking screen needs for one meeting of an offering. Null when the offering is unknown, the date
 * has no such class, or the viewer neither marks nor approves attendance there (the page renders a 404).
 */
export async function sessionForMarking(authed: Authed, offeringId: string, date: string, startsAt: string) {
  const c = await attendanceContext(authed);
  const offering = c?.offerings.get(offeringId);
  if (!c || !offering) return null;
  const canMark = canMarkCourse(authed.ctx, authed.tree, offering.sectionId, offering.courseCode);
  const canApprove = canApproveAttendanceIn(authed.ctx, authed.tree, offering.sectionId);
  if (!canMark && !canApprove && !canViewSectionAttendance(authed.ctx, authed.tree, offering.sectionId))
    return null;

  const slots = (await slotsFor(authed.ctx.tenantId, c.term.id)).filter((s) => s.offeringId === offeringId);
  const occurrence = occurrences(slots, c.holidayDates, date, date).find((o) => o.startsAt === startsAt);
  const [sessions, marks, roll, requests, leaves] = await Promise.all([
    loadSessions(db(), authed.ctx.tenantId, { offeringIds: [offeringId], from: date, to: date }),
    loadSessionMarks(db(), authed.ctx.tenantId, { offeringId, date, startsAt }),
    loadRoll(db(), authed.ctx.tenantId, offering.sectionId, date),
    pendingRequests(authed.ctx.tenantId),
    loadLeaves(db(), authed.ctx.tenantId, {}),
  ]);
  const recorded = sessions.find((s) => s.startsAt === startsAt) ?? null;
  // A class exists if the timetable schedules it that day, or it was recorded (e.g. before a timetable change).
  if (!occurrence && !recorded) return null;
  const leaveOnDay = new Map<string, RollEntry["leave"]>();
  for (const l of leaves) {
    if (date < l.fromDate || date > l.toDate) continue;
    if (l.status !== "approved" && l.status !== "pending") continue;
    const current = leaveOnDay.get(l.studentId);
    // Approved beats pending; OD beats medical (rules.ts).
    if (!current || (current.status === "pending" && l.status === "approved") || l.kind === "od")
      leaveOnDay.set(l.studentId, { kind: l.kind, status: l.status });
  }
  const request = requests.find((r) => sessionKey(r) === sessionKey({ offeringId, date, startsAt })) ?? null;
  return {
    offering,
    date,
    startsAt,
    endsAt: occurrence?.endsAt ?? recorded!.endsAt,
    room: occurrence?.room ?? null,
    window: markingWindow({ date, startsAt }, c.now),
    now: c.now,
    recorded,
    canMark,
    roll: roll.map((r): RollEntry => ({
      studentId: r.id,
      studentNumber: r.studentNumber,
      name: r.name,
      status: r.status,
      mark: marks.get(r.id) ?? null,
      leave: leaveOnDay.get(r.id) ?? null,
    })),
    pendingRequest: request
      ? {
          id: request.id,
          kind: request.kind,
          requestedBy: request.requestedBy,
          mine: request.requestedById === authed.ctx.userId,
          requestedAt: request.requestedAt.toISOString(),
        }
      : null,
  };
}

/* ---------- Approvals ---------- */

export type ApprovalKind = "correction" | "late_submission" | "od" | "medical";

export interface ApprovalItem {
  id: string;
  type: "attendance" | "leave";
  kind: ApprovalKind;
  title: string;
  detail: string;
  requester: string;
  requestedAt: string;
  dueAt: string;
  overdue: boolean;
  status: RequestRow["status"];
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  reason: string;
  /** Whether the viewer may approve or reject it now. */
  canDecide: boolean;
  /** Whether the viewer submitted it (and so may withdraw it while pending). */
  mine: boolean;
  /** Mark changes for corrections; the full proposed roll for late submissions. */
  changes?: { studentId: string; studentNumber: string; name: string; from: Mark | null; to: Mark }[];
  proposedStatus?: "held" | "cancelled";
  cancelReason?: string | null;
  href?: string;
}

const nowMs = () => institutionNow().getTime();

function fmtDay(date: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(
    localInstant(date, "12:00"),
  );
}

function requestItem(authed: Authed, r: RequestRow): ApprovalItem {
  const due = dueAt(r.requestedAt, r.kind);
  return {
    id: r.id,
    type: "attendance",
    kind: r.kind,
    title: `${r.kind === "correction" ? "Attendance correction" : "Late attendance"} — ${r.sectionLabel}, ${r.courseCode}, ${fmtDay(r.date)}`,
    detail: `${r.courseName} · ${r.startsAt}–${r.endsAt}`,
    requester: r.requestedBy,
    requestedAt: r.requestedAt.toISOString(),
    dueAt: due.toISOString(),
    overdue: r.status === "pending" && due.getTime() < nowMs(),
    status: r.status,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    reason: r.reason,
    canDecide:
      r.status === "pending" &&
      r.requestedById !== authed.ctx.userId &&
      canApproveAttendanceIn(authed.ctx, authed.tree, r.sectionId),
    mine: r.requestedById === authed.ctx.userId,
    proposedStatus: r.proposed.status,
    cancelReason: r.proposed.cancelReason ?? null,
    href: `/attendance/mark/${r.offeringId}?date=${r.date}&start=${r.startsAt}`,
  };
}

function leaveItem(authed: Authed, l: LeaveRow): ApprovalItem {
  const due = dueAt(l.requestedAt, l.kind);
  const days = l.fromDate === l.toDate ? fmtDay(l.fromDate) : `${fmtDay(l.fromDate)} – ${fmtDay(l.toDate)}`;
  return {
    id: l.id,
    type: "leave",
    kind: l.kind,
    title: `${l.kind === "od" ? "On-duty leave" : "Medical leave"} — ${l.studentName} (${l.studentNumber}), ${days}`,
    detail: `${l.sectionLabel}`,
    requester: l.requestedBy ?? "Recorded by the office",
    requestedAt: l.requestedAt.toISOString(),
    dueAt: due.toISOString(),
    overdue: l.status === "pending" && due.getTime() < nowMs(),
    status: l.status,
    decidedBy: l.decidedBy,
    decidedAt: l.decidedAt?.toISOString() ?? null,
    decisionNote: l.decisionNote,
    reason: l.reason,
    canDecide:
      l.status === "pending" &&
      l.requestedById !== authed.ctx.userId &&
      canDecideLeaveIn(authed.ctx, authed.tree, l.sectionId),
    mine: !!l.requestedById && l.requestedById === authed.ctx.userId,
    href: `/students/${l.studentId}`,
  };
}

/** Attach mark-level detail to attendance items (names from the section roll on the class date). */
async function withChanges(authed: Authed, items: ApprovalItem[], rows: RequestRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  await Promise.all(
    items
      .filter((i) => i.type === "attendance")
      .map(async (item) => {
        const r = byId.get(item.id)!;
        const [current, roll] = await Promise.all([
          loadSessionMarks(db(), authed.ctx.tenantId, r),
          loadRoll(db(), authed.ctx.tenantId, r.sectionId, r.date),
        ]);
        const names = new Map(roll.map((s) => [s.id, s]));
        const diff =
          r.kind === "correction"
            ? markChanges(current, r.proposed.marks)
            : Object.entries(r.proposed.marks).map(([studentId, to]) => ({ studentId, from: null, to }));
        item.changes = diff.map((d) => ({
          ...d,
          studentNumber: names.get(d.studentId)?.studentNumber ?? "—",
          name: names.get(d.studentId)?.name ?? "Student no longer on the roll",
        }));
      }),
  );
  return items;
}

const byDue = (a: ApprovalItem, b: ApprovalItem) => a.dueAt.localeCompare(b.dueAt);

/**
 * The approval queue: pending items the viewer may decide, the viewer's own requests, and recently decided items
 * in the viewer's scope.
 */
export async function approvalQueue(authed: Authed) {
  const tenantId = authed.ctx.tenantId;
  const [requests, leaves] = await Promise.all([
    loadRequests(db(), tenantId, { limit: 300 }),
    loadLeaves(db(), tenantId, {}),
  ]);
  const inScope = (sectionId: string) =>
    canApproveAttendanceIn(authed.ctx, authed.tree, sectionId) ||
    canDecideLeaveIn(authed.ctx, authed.tree, sectionId);
  const visibleRequests = requests.filter(
    (r) =>
      r.requestedById === authed.ctx.userId || canApproveAttendanceIn(authed.ctx, authed.tree, r.sectionId),
  );
  const visibleLeaves = leaves.filter(
    (l) => l.requestedById === authed.ctx.userId || canDecideLeaveIn(authed.ctx, authed.tree, l.sectionId),
  );
  const items = [
    ...visibleRequests.map((r) => requestItem(authed, r)),
    ...visibleLeaves.map((l) => leaveItem(authed, l)),
  ];
  await withChanges(
    authed,
    items.filter((i) => i.status === "pending" || i.mine),
    visibleRequests,
  );
  const approver =
    holdsAnywhere(authed.ctx, "attendance:approve") || holdsAnywhere(authed.ctx, "leave:approve");
  return {
    approver,
    waiting: items.filter((i) => i.canDecide).sort(byDue),
    mine: items.filter((i) => i.mine).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    decided: items
      .filter(
        (i) => i.status !== "pending" && !i.mine && inScope(sectionOfItem(i, visibleRequests, visibleLeaves)),
      )
      .sort((a, b) => (b.decidedAt ?? b.requestedAt).localeCompare(a.decidedAt ?? a.requestedAt))
      .slice(0, 40),
  };
}

function sectionOfItem(item: ApprovalItem, requests: RequestRow[], leaves: LeaveRow[]) {
  return item.type === "attendance"
    ? requests.find((r) => r.id === item.id)!.sectionId
    : leaves.find((l) => l.id === item.id)!.sectionId;
}

export interface PendingApproval {
  id: string;
  title: string;
  kind: ApprovalKind;
  requester: string;
  dueAt: string;
  overdue: boolean;
}

/**
 * Pending items the viewer may decide, most urgent first — for the dashboard and the top bar. Null when the viewer
 * holds no approval authority (the widget is not shown at all).
 */
export async function pendingApprovalsFor(authed: Authed): Promise<PendingApproval[] | null> {
  if (!holdsAnywhere(authed.ctx, "attendance:approve") && !holdsAnywhere(authed.ctx, "leave:approve"))
    return null;
  const [requests, leaves] = await Promise.all([
    pendingRequests(authed.ctx.tenantId),
    pendingLeaves(authed.ctx.tenantId),
  ]);
  return [...requests.map((r) => requestItem(authed, r)), ...leaves.map((l) => leaveItem(authed, l))]
    .filter((i) => i.canDecide)
    .sort(byDue)
    .map(({ id, title, kind, requester, dueAt, overdue }) => ({
      id,
      title,
      kind,
      requester,
      dueAt,
      overdue,
    }));
}

/* ---------- Analytics ---------- */

export interface SectionSummary {
  sectionId: string;
  sectionCode: string;
  sectionLabel: string;
  departmentCode: string;
  students: number;
  avgPct: number;
  short: number;
  threshold: number;
  /** Marked ÷ expected over the last 14 days (allocated offerings only); null when nothing was expected. */
  compliance: { expected: number; marked: number } | null;
}

/** Marked vs expected sessions per section over the last `days` days up to yesterday. */
async function compliance(authed: Authed, c: AttendanceContext, sectionIds: Set<string>, days = 14) {
  const to = addDays(c.now.date, -1);
  const from = addDays(c.now.date, -days);
  const offerings = [...c.offerings.values()].filter(
    (o) => sectionIds.has(o.sectionId) && o.allocations.length > 0,
  );
  const ids = new Set(offerings.map((o) => o.id));
  const slots = (await slotsFor(authed.ctx.tenantId, c.term.id)).filter((s) => ids.has(s.offeringId));
  const expected = occurrences(slots, c.holidayDates, from < c.term.startsOn ? c.term.startsOn : from, to);
  const sessions = await loadSessions(db(), authed.ctx.tenantId, { offeringIds: [...ids], from, to });
  const recorded = new Set(sessions.map(sessionKey));
  const out = new Map<string, { expected: number; marked: number }>();
  for (const o of expected) {
    const sectionId = c.offerings.get(o.offeringId)!.sectionId;
    const entry = out.get(sectionId) ?? { expected: 0, marked: 0 };
    entry.expected += 1;
    if (recorded.has(sessionKey(o))) entry.marked += 1;
    out.set(sectionId, entry);
  }
  return out;
}

/** Sections whose attendance the viewer may analyse, worst average first. */
export async function attendanceOverview(authed: Authed): Promise<SectionSummary[] | null> {
  const c = await attendanceContext(authed);
  if (!c) return null;
  const rows = (await visibleStudents(authed)).filter((v) => v.access.academic);
  const bySection = new Map<string, Visible[]>();
  for (const v of rows)
    bySection.set(v.student.sectionId, [...(bySection.get(v.student.sectionId) ?? []), v]);
  const sections = [...bySection.keys()]
    .map((code) => authed.tree.byCode.get(code))
    .filter(
      (u): u is NonNullable<typeof u> => !!u && canViewSectionAttendance(authed.ctx, authed.tree, u.id),
    );
  if (sections.length === 0) return null;
  const marked = await compliance(authed, c, new Set(sections.map((u) => u.id)));
  return sections
    .map((unit) => {
      const list = bySection.get(unit.code)!;
      const first = list[0]!.student;
      return {
        sectionId: unit.id,
        sectionCode: unit.code,
        sectionLabel: first.sectionLabel,
        departmentCode: first.departmentCode,
        students: list.length,
        avgPct: list.reduce((n, v) => n + v.student.attendancePct, 0) / list.length,
        short: list.filter((v) => v.student.attendancePct < v.student.attendanceThreshold).length,
        threshold: first.attendanceThreshold,
        compliance: marked.get(unit.id) ?? null,
      };
    })
    .sort((a, b) => a.avgPct - b.avgPct);
}

/** One section's attendance: students × courses, the register of recent sessions, and marking gaps. */
export async function sectionReport(authed: Authed, sectionCode: string) {
  const c = await attendanceContext(authed);
  const unit = authed.tree.byCode.get(sectionCode);
  if (!c || !unit || unit.type !== "section" || !canViewSectionAttendance(authed.ctx, authed.tree, unit.id))
    return null;
  const students = (await visibleStudents(authed)).filter(
    (v) => v.student.sectionId === sectionCode && v.access.academic,
  );
  const offerings = [...c.offerings.values()].filter((o) => o.sectionId === unit.id);
  const ids = new Set(offerings.map((o) => o.id));
  const slots = (await slotsFor(authed.ctx.tenantId, c.term.id)).filter((s) => ids.has(s.offeringId));
  const sessions = await loadSessions(db(), authed.ctx.tenantId, { offeringIds: [...ids] });
  const expected = occurrences(slots, c.holidayDates, c.term.startsOn, addDays(c.now.date, -1)).filter(
    (o) => c.offerings.get(o.offeringId)!.allocations.length > 0,
  );
  const gaps = await decorate(authed, c, unmarked(expected, new Set(sessions.map(sessionKey))));
  const subjects = new Map(
    await Promise.all(students.map(async (v) => [v.student.id, await subjectsFor(authed, v)] as const)),
  );
  return {
    unit,
    now: c.now,
    offerings,
    students,
    subjects,
    sessions: sessions.slice(0, 30).map((s) => ({ ...s, offering: c.offerings.get(s.offeringId)! })),
    gaps,
    held: sessions.filter((s) => s.status === "held").length,
    cancelled: sessions.filter((s) => s.status === "cancelled").length,
  };
}

/* ---------- A student's own attendance ---------- */

/** Subject attendance, recent register, leave history and whether the viewer may apply for leave. */
export async function studentAttendance(authed: Authed, v: Visible) {
  const ref = studentRef(v.student, authed.ctx.tenantId);
  const access = studentFieldAccess(authed.ctx, authed.tree, ref);
  if (!access.academic) return null;
  const [log, leaves] = await Promise.all([
    loadStudentLog(db(), authed.ctx.tenantId, v.student.id),
    loadLeaves(db(), authed.ctx.tenantId, { studentIds: [v.student.id] }),
  ]);
  return {
    log,
    leaves: leaves.map((l) => ({
      ...l,
      requestedAt: l.requestedAt.toISOString(),
      decidedAt: l.decidedAt?.toISOString() ?? null,
      mine: !!l.requestedById && l.requestedById === authed.ctx.userId,
    })),
    canRequestLeave: canRequestLeaveFor(authed.ctx, authed.tree, ref),
    now: institutionToday(),
  };
}

export interface TimetableEntry {
  weekday: number;
  startsAt: string;
  endsAt: string;
  room: string;
  courseCode: string;
  courseName: string;
  teachers: string[];
}

/** A section's weekly timetable for the current term (slots in effect today), for students and guardians. */
export async function weeklyTimetable(authed: Authed, sectionCode: string): Promise<TimetableEntry[] | null> {
  const c = await attendanceContext(authed);
  if (!c) return null;
  const offerings = [...c.offerings.values()].filter((o) => o.sectionCode === sectionCode);
  const byId = new Map(offerings.map((o) => [o.id, o]));
  const today = c.now.date;
  return (await slotsFor(authed.ctx.tenantId, c.term.id))
    .filter(
      (s) => byId.has(s.offeringId) && s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today),
    )
    .map((s) => {
      const o = byId.get(s.offeringId)!;
      return {
        weekday: s.weekday,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        room: s.room,
        courseCode: o.courseCode,
        courseName: o.courseName,
        teachers: o.allocations.map((a) => a.name),
      };
    })
    .sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
}
