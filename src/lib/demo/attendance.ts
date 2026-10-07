/**
 * SYNTHETIC attendance history for the current term, from the first teaching day up to the day before DEMO_NOW:
 * holidays, sessions (a few cancelled, a few deliberately never marked), every student's present/absent mark,
 * student leave (OD and medical) and attendance requests. The seed streams this into Neon; the in-memory twin
 * (fixtures.ts) aggregates it with the same rules the database query applies, so tests can compare the two.
 */
import { addDays, datesBetween, localDate, weekdayOf } from "@/domains/attendance/calendar";
import {
  addEffective,
  effectiveStatus,
  emptyTally,
  leaveOn,
  type AttendanceRequestKind,
  type LeaveSpan,
  type Mark,
  type RequestStatus,
  type Tally,
} from "@/domains/attendance/rules";
import { currentTermOfferings } from "./academics";
import { clamp, DEMO_NOW, hash, pick, rng, rollNumbers, SECTIONS } from "./base";
import { TIMETABLE, type SlotSpec } from "./timetable";

export const DEMO_TODAY = localDate(DEMO_NOW);

export const HOLIDAYS: { date: string; name: string }[] = [
  { date: "2026-08-15", name: "Independence Day" },
  { date: "2026-09-04", name: "Janmashtami" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Gandhi Jayanti" },
];

/** The base rate a student attends at — the same draws Phase 2's synthetic signals made, so cohorts keep their shape. */
export function attendanceBase(studentNumber: string): number {
  const r = rng(hash(`signals:${studentNumber}`));
  const roll = r();
  return roll < 0.05 ? 0.55 + r() * 0.1 : roll < 0.16 ? 0.66 + r() * 0.08 : 0.77 + r() * 0.2;
}

/** Programme overrides of the institution's 75% threshold (synthetic example: MBA requires 80%). */
export const PROGRAMME_THRESHOLDS: Record<string, number> = { MBA: 80 };

/* ---------- Leave ---------- */

export interface LeaveSpec extends LeaveSpan {
  key: string;
  studentNumber: string;
  reason: string;
  status: RequestStatus;
  /** Persona key of the requester; null for an application recorded by the office. */
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

export const LEAVES: LeaveSpec[] = [
  ...["24CSE001", "24CSE003", "24CSE006", "24CSE010"].map((n, i): LeaveSpec => ({
    key: `od-hackathon-${i}`,
    studentNumber: n,
    kind: "od",
    fromDate: "2026-09-17",
    toDate: "2026-09-18",
    reason: "Inter-college hackathon — department-nominated team",
    status: "approved",
    requestedBy: null,
    requestedAt: at("2026-09-15", "10:00"),
    decidedBy: "class_incharge",
    decidedAt: at("2026-09-15", "16:30"),
    decisionNote: "Nomination letter from the event coordinator on file.",
  })),
  ...(
    [
      ["24CSE020", "2026-08-11", "2026-08-13"],
      ["25CSE007", "2026-09-08", "2026-09-10"],
      ["23CSE030", "2026-08-25", "2026-08-28"],
      ["26CSE015", "2026-09-21", "2026-09-22"],
      ["24CSE033", "2026-09-23", "2026-09-25"],
    ] as const
  ).map(([n, fromDate, toDate], i): LeaveSpec => ({
    key: `medical-${i}`,
    studentNumber: n,
    kind: "medical",
    fromDate,
    toDate,
    reason: "Viral fever — medical certificate submitted",
    status: "approved",
    requestedBy: null,
    requestedAt: at(addDays(toDate, 1), "09:15"),
    decidedBy: "hod_cse",
    decidedAt: at(addDays(toDate, 1), "15:00"),
    decisionNote: null,
  })),
  {
    key: "od-rejected",
    studentNumber: "25CSE012",
    kind: "od",
    fromDate: "2026-09-24",
    toDate: "2026-09-24",
    reason: "Cultural fest at another college",
    status: "rejected",
    requestedBy: null,
    requestedAt: at("2026-09-23", "11:00"),
    decidedBy: "hod_cse",
    decidedAt: at("2026-09-23", "17:00"),
    decisionNote: "No nomination letter from the event coordinator.",
  },
  {
    key: "medical-pending-persona",
    studentNumber: "24CSE001",
    kind: "medical",
    fromDate: "2026-10-05",
    toDate: "2026-10-05",
    reason: "Fever; doctor advised rest for a day",
    status: "pending",
    requestedBy: "parent",
    requestedAt: at("2026-10-05", "19:40"),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  },
  {
    key: "medical-pending-office",
    studentNumber: "24CSE022",
    kind: "medical",
    fromDate: "2026-09-30",
    toDate: "2026-10-01",
    reason: "Hospitalised — discharge summary attached at the office",
    status: "pending",
    requestedBy: null,
    requestedAt: at("2026-10-03", "10:30"),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  },
];

/** Approved leave per student — the only leave that changes how attendance counts. */
const APPROVED_LEAVE = new Map<string, LeaveSpan[]>();
for (const l of LEAVES)
  if (l.status === "approved")
    APPROVED_LEAVE.set(l.studentNumber, [...(APPROVED_LEAVE.get(l.studentNumber) ?? []), l]);

/** Students were away on any leave they applied for, approved or not. */
function awayOn(studentNumber: string, date: string): boolean {
  return LEAVES.some((l) => l.studentNumber === studentNumber && date >= l.fromDate && date <= l.toDate);
}

/* ---------- Sessions ---------- */

export interface SessionSpec {
  sectionCode: string;
  courseCode: string;
  date: string;
  startsAt: string;
  endsAt: string;
  status: "held" | "cancelled";
  cancelReason: string | null;
  /** Who marked it: the allocated teacher. */
  facultyName: string | null;
  /** False for a session that was held but never marked (it needs a late submission). */
  recorded: boolean;
}

export interface GeneratedSession {
  session: SessionSpec;
  /** Roll number → mark; empty for a cancelled session. */
  marks: [studentNumber: string, mark: Mark][];
}

const CANCEL_REASONS = [
  "Faculty on approved leave",
  "Department seminar",
  "Rescheduled for internal assessment",
];
const HOLIDAY_DATES = new Set(HOLIDAYS.map((h) => h.date));
const LAST_MARKED_DAY = addDays(DEMO_TODAY, -1);

const offeringKey = (sectionCode: string, courseCode: string) => `${sectionCode}/${courseCode}`;

/** Teaching dates of a slot from its effective date up to and including `until`. */
export function slotDates(slot: Pick<SlotSpec, "weekday" | "effectiveFrom">, until: string): string[] {
  return datesBetween(slot.effectiveFrom, until).filter(
    (d) => weekdayOf(d) === slot.weekday && !HOLIDAY_DATES.has(d),
  );
}

const FACULTY_OF = new Map(
  currentTermOfferings().map((o) => [offeringKey(o.sectionCode, o.courseCode), o.facultyName]),
);

/** Every held-or-cancelled session the history contains, per offering in date order. Unallocated offerings never met. */
function sessionsByOffering(): Map<string, SessionSpec[]> {
  const out = new Map<string, SessionSpec[]>();
  for (const slot of TIMETABLE) {
    const key = offeringKey(slot.sectionCode, slot.courseCode);
    const facultyName = FACULTY_OF.get(key) ?? null;
    if (!facultyName) continue;
    for (const date of slotDates(slot, LAST_MARKED_DAY)) {
      const r = rng(hash(`cancel:${key}:${date}:${slot.startsAt}`));
      const cancelled = r() < 0.012;
      const list = out.get(key) ?? [];
      list.push({
        sectionCode: slot.sectionCode,
        courseCode: slot.courseCode,
        date,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: cancelled ? "cancelled" : "held",
        cancelReason: cancelled ? pick(r, CANCEL_REASONS) : null,
        facultyName,
        recorded: true,
      });
      out.set(key, list);
    }
  }
  for (const list of out.values())
    list.sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt));
  return out;
}

const SESSIONS = sessionsByOffering();

function lastSession(key: string): SessionSpec {
  const held = (SESSIONS.get(key) ?? []).filter((s) => s.status === "held");
  const last = held.at(-1);
  if (!last) throw new Error(`Attendance: ${key} has no held session`);
  return last;
}

/** The first allocated offering of 2-MECH-A, whose latest session was submitted late (pending approval). */
const LATE_KEY = [...SESSIONS.keys()].filter((k) => k.startsWith("MECH-2-A/")).sort()[0]!;

/** Sessions that were held but never marked, and the persona correction session. */
export const SCRIPTED_SESSIONS = {
  /** Rahul Verma never marked his latest 3-CSE-B class — it shows on his task list as overdue. */
  unmarked: lastSession("CSE-3-B/CS301"),
  /** Submitted late by its teacher; waiting for the principal (no MECH head is a demo persona). */
  lateSubmitted: lastSession(LATE_KEY),
  /** Rahul Verma asked to correct two marks on this class; the HOD has not decided yet (past SLA). */
  correction: (SESSIONS.get("CSE-3-B/CS301") ?? []).find(
    (s) => s.date === "2026-09-29" && s.status === "held",
  )!,
};
for (const s of [SCRIPTED_SESSIONS.unmarked, SCRIPTED_SESSIONS.lateSubmitted]) s.recorded = false;

const sameSession = (a: SessionSpec, b: SessionSpec) =>
  a.sectionCode === b.sectionCode &&
  a.courseCode === b.courseCode &&
  a.date === b.date &&
  a.startsAt === b.startsAt;

/** Two students the correction says were wrongly marked absent (they were at a department seminar). */
export function correctionStudents(): string[] {
  const rolls = rollNumbers(SECTIONS.find((s) => s.id === SCRIPTED_SESSIONS.correction.sectionCode)!);
  return [rolls[3]!, rolls[7]!];
}

/**
 * Every session with its marks, offering by offering. Each student attends at a personal rate per course; a
 * student on any leave they applied for was away that day.
 */
export function* attendanceHistory(): Generator<GeneratedSession> {
  const forcedAbsent = new Set(correctionStudents());
  for (const key of [...SESSIONS.keys()].sort()) {
    const sessions = SESSIONS.get(key)!;
    const [sectionCode, courseCode] = key.split("/") as [string, string];
    const rolls = rollNumbers(SECTIONS.find((s) => s.id === sectionCode)!);
    const draws = rolls.map((n) => {
      const r = rng(hash(`mark:${n}:${courseCode}`));
      return { n, r, rate: clamp(attendanceBase(n) + (r() - 0.5) * 0.12, 0.35, 1) };
    });
    for (const session of sessions) {
      if (session.status === "cancelled") {
        yield { session, marks: [] };
        continue;
      }
      const isCorrection = sameSession(session, SCRIPTED_SESSIONS.correction);
      const marks = draws.map(({ n, r, rate }): [string, Mark] => {
        const u = r();
        if (awayOn(n, session.date) || (isCorrection && forcedAbsent.has(n))) return [n, "absent"];
        return [n, u < rate ? "present" : "absent"];
      });
      yield { session, marks };
    }
  }
}

/* ---------- Requests ---------- */

export interface RequestSpec {
  key: string;
  session: SessionSpec;
  kind: AttendanceRequestKind;
  reason: string;
  status: RequestStatus;
  requestedBy: string;
  requestedAt: string;
  /** Proposed marks by roll number. */
  marks: Record<string, Mark>;
}

/** Attendance requests in the demo history: a correction past its SLA and a late submission still within it. */
export function attendanceRequests(): RequestSpec[] {
  const want = [SCRIPTED_SESSIONS.correction, SCRIPTED_SESSIONS.lateSubmitted];
  const found = new Map<SessionSpec, Record<string, Mark>>();
  for (const { session, marks } of attendanceHistory())
    if (want.includes(session)) found.set(session, Object.fromEntries(marks));
  const corrected = { ...found.get(SCRIPTED_SESSIONS.correction)! };
  for (const n of correctionStudents()) corrected[n] = "present";
  return [
    {
      key: "correction-cs301-3b",
      session: SCRIPTED_SESSIONS.correction,
      kind: "correction",
      reason: "Two students were at the department seminar and were marked absent by mistake.",
      status: "pending",
      requestedBy: SCRIPTED_SESSIONS.correction.facultyName!,
      requestedAt: at("2026-10-03", "10:15"),
      marks: corrected,
    },
    {
      key: "late-mech-2a",
      session: SCRIPTED_SESSIONS.lateSubmitted,
      kind: "late_submission",
      reason: "Marked on paper during the network outage; entering it now.",
      status: "pending",
      requestedBy: SCRIPTED_SESSIONS.lateSubmitted.facultyName!,
      requestedAt: at(addDays(SCRIPTED_SESSIONS.lateSubmitted.date, 1), "09:00"),
      marks: found.get(SCRIPTED_SESSIONS.lateSubmitted)!,
    },
  ];
}

/* ---------- Twin aggregate ---------- */

/** Per student and course, the tally the database query must reproduce (recorded sessions, approved leave). */
export function attendanceTallies(): Map<string, Map<string, Tally>> {
  const out = new Map<string, Map<string, Tally>>();
  for (const { session, marks } of attendanceHistory()) {
    if (!session.recorded || session.status !== "held") continue;
    for (const [n, mark] of marks) {
      const byCourse = out.get(n) ?? new Map<string, Tally>();
      const tally = byCourse.get(session.courseCode) ?? emptyTally();
      addEffective(tally, effectiveStatus(mark, leaveOn(APPROVED_LEAVE.get(n) ?? [], session.date)));
      byCourse.set(session.courseCode, tally);
      out.set(n, byCourse);
    }
  }
  return out;
}
