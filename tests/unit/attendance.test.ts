import { describe, expect, it } from "vitest";
import {
  addDays,
  datesBetween,
  localDate,
  localNow,
  localTime,
  weekdayOf,
} from "@/domains/attendance/calendar";
import {
  canApproveAttendanceIn,
  canDecideLeaveIn,
  canMarkCourse,
  canRequestLeaveFor,
  canSetInstitutionPolicy,
  canViewSectionAttendance,
} from "@/domains/attendance/guards";
import {
  addEffective,
  dueAt,
  effectiveStatus,
  emptyTally,
  leaveOn,
  markChanges,
  markingWindow,
  percentOf,
} from "@/domains/attendance/rules";
import { occurrences, unmarked, type SlotRef } from "@/domains/attendance/schedule";
import { COURSE_CATALOGUE, currentTermOfferings } from "@/lib/demo/academics";
import {
  attendanceRequests,
  attendanceTallies,
  correctionStudents,
  DEMO_TODAY,
  HOLIDAYS,
  LEAVES,
  SCRIPTED_SESSIONS,
} from "@/lib/demo/attendance";
import { DEMO_NOW, STUDENTS } from "@/lib/demo/fixtures";
import { TIMETABLE, weeklySessions } from "@/lib/demo/timetable";
import { ctxFor, demoTree } from "../helpers/demo-authz";

const unit = (code: string) => demoTree.byCode.get(code)!.id;
const ref = (studentNumber: string) => {
  const s = STUDENTS.find((x) => x.studentNumber === studentNumber)!;
  return { tenantId: ctxFor("principal").tenantId, studentNumber, sectionCode: s.sectionId };
};

describe("institution calendar", () => {
  it("reads instants in the institution's zone, not the server's", () => {
    expect(localDate(DEMO_NOW)).toBe("2026-10-06");
    expect(localTime(DEMO_NOW)).toBe("09:30");
    // 23:30 UTC on 5 Oct is already 6 Oct in India.
    expect(localNow(new Date("2026-10-05T23:30:00Z"))).toEqual({ date: "2026-10-06", time: "05:00" });
  });

  it("does weekday and date arithmetic on plain dates", () => {
    expect(weekdayOf("2026-10-06")).toBe(2);
    expect(weekdayOf("2026-10-04")).toBe(7);
    expect(addDays("2026-09-30", 2)).toBe("2026-10-02");
    expect(datesBetween("2026-10-01", "2026-10-03")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(datesBetween("2026-10-03", "2026-10-01")).toEqual([]);
  });
});

describe("attendance rules", () => {
  it("counts approved OD as attended and approved medical leave as excused", () => {
    expect(effectiveStatus("present", null)).toBe("present");
    expect(effectiveStatus("absent", null)).toBe("absent");
    expect(effectiveStatus("absent", "od")).toBe("od");
    expect(effectiveStatus("absent", "medical")).toBe("excused");
    // Leave never turns a recorded presence into anything else.
    expect(effectiveStatus("present", "medical")).toBe("present");
  });

  it("prefers OD when both kinds of leave cover a day", () => {
    const leaves = [
      { kind: "medical" as const, fromDate: "2026-09-01", toDate: "2026-09-05" },
      { kind: "od" as const, fromDate: "2026-09-04", toDate: "2026-09-04" },
    ];
    expect(leaveOn(leaves, "2026-09-02")).toBe("medical");
    expect(leaveOn(leaves, "2026-09-04")).toBe("od");
    expect(leaveOn(leaves, "2026-09-06")).toBeNull();
  });

  it("removes excused classes from the denominator", () => {
    const t = emptyTally();
    for (const e of ["present", "present", "absent", "od", "excused"] as const) addEffective(t, e);
    expect(t).toEqual({ held: 4, attended: 3, od: 1, excused: 1 });
    expect(percentOf(t)).toBe(75);
    expect(percentOf(emptyTally())).toBe(100);
  });

  it("opens marking on the class's own day from its start time only", () => {
    const now = { date: "2026-10-06", time: "09:30" };
    expect(markingWindow({ date: "2026-10-06", startsAt: "09:00" }, now)).toBe("open");
    expect(markingWindow({ date: "2026-10-06", startsAt: "10:00" }, now)).toBe("upcoming");
    expect(markingWindow({ date: "2026-10-07", startsAt: "09:00" }, now)).toBe("upcoming");
    expect(markingWindow({ date: "2026-10-05", startsAt: "15:00" }, now)).toBe("closed");
  });

  it("lists only the marks a correction changes", () => {
    const current = new Map([
      ["a", "present" as const],
      ["b", "absent" as const],
    ]);
    expect(markChanges(current, { a: "present", b: "present", c: "absent" })).toEqual([
      { studentId: "b", from: "absent", to: "present" },
      { studentId: "c", from: null, to: "absent" },
    ]);
  });

  it("gives corrections 48 hours and leave 24 hours", () => {
    const at = new Date("2026-10-03T10:00:00+05:30");
    expect(dueAt(at, "correction").toISOString()).toBe(new Date("2026-10-05T10:00:00+05:30").toISOString());
    expect(dueAt(at, "medical").toISOString()).toBe(new Date("2026-10-04T10:00:00+05:30").toISOString());
  });
});

describe("expected sessions", () => {
  const slots: SlotRef[] = [
    {
      id: "s1",
      offeringId: "o1",
      weekday: 2,
      startsAt: "09:00",
      endsAt: "09:55",
      room: "R",
      effectiveFrom: "2026-09-01",
      effectiveTo: null,
    },
    {
      id: "s2",
      offeringId: "o1",
      weekday: 4,
      startsAt: "11:15",
      endsAt: "12:10",
      room: "R",
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-09-24",
    },
  ];

  it("expands the timetable over dates, skipping holidays and slots outside their dates", () => {
    const out = occurrences(slots, new Set(["2026-09-15"]), "2026-09-08", "2026-10-01");
    expect(out.map((o) => `${o.date} ${o.startsAt}`)).toEqual([
      "2026-09-08 09:00",
      "2026-09-10 11:15",
      "2026-09-17 11:15",
      "2026-09-22 09:00",
      "2026-09-24 11:15",
      "2026-09-29 09:00",
    ]);
  });

  it("reports expected meetings with no record as unmarked", () => {
    const out = occurrences(slots, new Set(), "2026-09-08", "2026-09-10");
    expect(unmarked(out, new Set(["o1|2026-09-08|09:00"])).map((o) => o.date)).toEqual(["2026-09-10"]);
  });
});

describe("who may mark, approve and apply", () => {
  it("lets teachers mark only the courses they teach, and the class incharge any course of their class", () => {
    const rahul = ctxFor("faculty");
    expect(canMarkCourse(rahul, demoTree, unit("CSE-3-A"), "CS301")).toBe(true);
    expect(canMarkCourse(rahul, demoTree, unit("CSE-3-A"), "CS302")).toBe(false);
    expect(canMarkCourse(rahul, demoTree, unit("CSE-3-C"), "CS301")).toBe(false);
    const kavya = ctxFor("class_incharge");
    expect(canMarkCourse(kavya, demoTree, unit("CSE-3-A"), "CS301")).toBe(true);
    expect(canMarkCourse(kavya, demoTree, unit("CSE-3-B"), "CS302")).toBe(true);
    expect(canMarkCourse(kavya, demoTree, unit("CSE-3-B"), "CS301")).toBe(false);
    expect(canMarkCourse(ctxFor("student"), demoTree, unit("CSE-3-A"), "CS301")).toBe(false);
  });

  it("gives attendance approval to the HOD and principal, and leave decisions to the class incharge too", () => {
    expect(canApproveAttendanceIn(ctxFor("hod_cse"), demoTree, unit("CSE-3-B"))).toBe(true);
    expect(canApproveAttendanceIn(ctxFor("hod_cse"), demoTree, unit("MECH-2-A"))).toBe(false);
    expect(canApproveAttendanceIn(ctxFor("principal"), demoTree, unit("MECH-2-A"))).toBe(true);
    expect(canApproveAttendanceIn(ctxFor("class_incharge"), demoTree, unit("CSE-3-A"))).toBe(false);
    expect(canDecideLeaveIn(ctxFor("class_incharge"), demoTree, unit("CSE-3-A"))).toBe(true);
    expect(canDecideLeaveIn(ctxFor("class_incharge"), demoTree, unit("CSE-3-B"))).toBe(false);
    expect(canDecideLeaveIn(ctxFor("faculty"), demoTree, unit("CSE-3-A"))).toBe(false);
  });

  it("lets students and guardians apply for leave only for their own record", () => {
    expect(canRequestLeaveFor(ctxFor("student"), demoTree, ref("24CSE001"))).toBe(true);
    expect(canRequestLeaveFor(ctxFor("student"), demoTree, ref("24CSE002"))).toBe(false);
    expect(canRequestLeaveFor(ctxFor("parent"), demoTree, ref("24CSE001"))).toBe(true);
    expect(canRequestLeaveFor(ctxFor("faculty"), demoTree, ref("24CSE001"))).toBe(false);
  });

  it("limits analytics to cohort-academic readers and policy to institution managers", () => {
    expect(canViewSectionAttendance(ctxFor("class_incharge"), demoTree, unit("CSE-3-A"))).toBe(true);
    expect(canViewSectionAttendance(ctxFor("faculty"), demoTree, unit("CSE-3-A"))).toBe(false);
    expect(canSetInstitutionPolicy(ctxFor("principal"), demoTree)).toBe(true);
    expect(canSetInstitutionPolicy(ctxFor("hod_cse"), demoTree)).toBe(false);
  });
});

describe("synthetic timetable", () => {
  const offerings = currentTermOfferings();
  const catalogue = new Map(COURSE_CATALOGUE.map((c) => [c.code, c]));

  it("schedules every offering's weekly contact hours", () => {
    for (const o of offerings) {
      const slots = TIMETABLE.filter((s) => s.sectionCode === o.sectionCode && s.courseCode === o.courseCode);
      expect(slots).toHaveLength(weeklySessions(catalogue.get(o.courseCode)!).length);
    }
  });

  it("never puts a section or a teacher in two places at once", () => {
    const teacher = new Map(offerings.map((o) => [`${o.sectionCode}/${o.courseCode}`, o.facultyName]));
    const overlaps = (a: (typeof TIMETABLE)[number], b: (typeof TIMETABLE)[number]) =>
      a.weekday === b.weekday && a.startsAt < b.endsAt && b.startsAt < a.endsAt;
    for (let i = 0; i < TIMETABLE.length; i++)
      for (let j = i + 1; j < TIMETABLE.length; j++) {
        const a = TIMETABLE[i]!;
        const b = TIMETABLE[j]!;
        if (!overlaps(a, b)) continue;
        expect(a.sectionCode, `${a.sectionCode} ${a.weekday} ${a.startsAt}`).not.toBe(b.sectionCode);
        const ta = teacher.get(`${a.sectionCode}/${a.courseCode}`);
        if (ta) expect(ta).not.toBe(teacher.get(`${b.sectionCode}/${b.courseCode}`));
      }
  });

  it("gives the personas a stable Tuesday", () => {
    const tue = (section: string, course: string) =>
      TIMETABLE.filter((s) => s.sectionCode === section && s.courseCode === course && s.weekday === 2).map(
        (s) => s.startsAt,
      );
    expect(tue("CSE-3-A", "CS301")).toContain("09:00");
    expect(tue("CSE-3-A", "CS302")).toContain("10:00");
    expect(tue("CSE-3-B", "CS301")).toContain("11:15");
  });
});

describe("synthetic attendance history", () => {
  it("stops before today and never meets on a holiday", () => {
    expect(SCRIPTED_SESSIONS.unmarked.date < DEMO_TODAY).toBe(true);
    expect(HOLIDAYS.map((h) => h.date)).not.toContain(SCRIPTED_SESSIONS.correction.date);
  });

  it("scripts two pending requests: an overdue correction and a late submission within SLA", () => {
    const requests = attendanceRequests();
    expect(requests.map((r) => [r.kind, r.status])).toEqual([
      ["correction", "pending"],
      ["late_submission", "pending"],
    ]);
    const correction = requests[0]!;
    for (const n of correctionStudents()) expect(correction.marks[n]).toBe("present");
    const due = (r: (typeof requests)[number]) => dueAt(new Date(r.requestedAt), r.kind).getTime();
    expect(due(correction)).toBeLessThan(DEMO_NOW.getTime());
    expect(due(requests[1]!)).toBeGreaterThan(DEMO_NOW.getTime());
  });

  it("applies approved leave in the twin's tallies", () => {
    const tallies = attendanceTallies();
    const od = [...(tallies.get("24CSE003")?.values() ?? [])].reduce((n, t) => n + t.od, 0);
    const excused = [...(tallies.get("24CSE020")?.values() ?? [])].reduce((n, t) => n + t.excused, 0);
    expect(od).toBeGreaterThan(0);
    expect(excused).toBeGreaterThan(0);
    // Pending and rejected leave change nothing.
    const pending = LEAVES.find((l) => l.key === "medical-pending-persona")!;
    expect(pending.status).toBe("pending");
    const persona = [...(tallies.get(pending.studentNumber)?.values() ?? [])].reduce(
      (n, t) => n + t.excused,
      0,
    );
    expect(persona).toBe(0);
  });

  it("keeps a realistic share of students below their threshold", () => {
    const short = STUDENTS.filter((s) => s.attendancePct < s.attendanceThreshold).length / STUDENTS.length;
    expect(short).toBeGreaterThan(0.08);
    expect(short).toBeLessThan(0.3);
  });
});
