/**
 * SYNTHETIC weekly timetable for the current term: every allocated or unallocated offering gets its contact hours
 * as slots on a Monday–Friday grid of six periods, with no section or teacher in two places at once. The seed
 * writes these slots; the attendance generator and unit tests read them directly.
 */
import { COURSE_CATALOGUE, currentTermOfferings, type CourseSpec, type OfferingSpec } from "./academics";
import { hash, SECTIONS } from "./base";

export const PERIODS = [
  { start: "09:00", end: "09:55" },
  { start: "10:00", end: "10:55" },
  { start: "11:15", end: "12:10" },
  { start: "12:15", end: "13:10" },
  { start: "14:00", end: "14:55" },
  { start: "15:00", end: "15:55" },
] as const;

/** Double periods (labs, projects) run across a break-free pair. */
const DOUBLE_STARTS = [0, 2, 4];
export const TEACHING_DAYS = [1, 2, 3, 4, 5];

/** Timetables apply from the first teaching day: continuing years in July, first years after induction. */
export const TIMETABLE_FROM = { continuing: "2026-07-06", firstYear: "2026-08-24" } as const;

export interface SlotSpec {
  sectionCode: string;
  courseCode: string;
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  startsAt: string;
  endsAt: string;
  room: string;
  effectiveFrom: string;
}

/**
 * Scripted so the demo personas have a stable Tuesday (DEMO_NOW is Tuesday 09:30): Rahul Verma's CS301 for 3-CSE-A
 * is in progress, Kavya Nair's CS302 has not started, and 3-CSE-B's CS301 follows the break.
 */
const PINNED: { key: string; weekday: number; period: number }[] = [
  { key: "CSE-3-A/CS301", weekday: 2, period: 0 },
  { key: "CSE-3-A/CS302", weekday: 2, period: 1 },
  { key: "CSE-3-B/CS301", weekday: 2, period: 2 },
];

const BLOCK: Record<string, string> = { CSE: "TB", MCA: "TB", ECE: "EB", EEE: "EB", MECH: "MB", MBA: "MG" };

function roomFor(sectionCode: string, course: CourseSpec): string {
  const [dept = "", year = "", letter = "A"] = sectionCode.split("-");
  if (course.type === "lab") return `${dept} Workshop`;
  if (course.type === "project") return `${dept} Project Lab`;
  return `${BLOCK[dept] ?? "TB"}-${year}0${letter.charCodeAt(0) - 64}`;
}

/** Weekly sessions an offering needs: theory one period per contact hour, practical work in double periods. */
export function weeklySessions(course: CourseSpec): (1 | 2)[] {
  if (course.type === "theory") return Array(course.lectureHours + course.tutorialHours).fill(1);
  return Array(Math.ceil(course.practicalHours / 2)).fill(2);
}

function build(offerings: readonly OfferingSpec[]): SlotSpec[] {
  const catalogue = new Map(COURSE_CATALOGUE.map((c) => [c.code, c]));
  const sectionBusy = new Set<string>();
  const facultyBusy = new Set<string>();
  const out: SlotSpec[] = [];
  const firstYear = new Set(SECTIONS.filter((s) => s.year === 1).map((s) => s.id));

  const place = (o: OfferingSpec, course: CourseSpec, weekday: number, period: number, length: 1 | 2) => {
    for (let p = period; p < period + length; p++) {
      sectionBusy.add(`${o.sectionCode}|${weekday}|${p}`);
      if (o.facultyName) facultyBusy.add(`${o.facultyName}|${weekday}|${p}`);
    }
    out.push({
      sectionCode: o.sectionCode,
      courseCode: o.courseCode,
      weekday,
      startsAt: PERIODS[period]!.start,
      endsAt: PERIODS[period + length - 1]!.end,
      room: roomFor(o.sectionCode, course),
      effectiveFrom: firstYear.has(o.sectionCode) ? TIMETABLE_FROM.firstYear : TIMETABLE_FROM.continuing,
    });
  };
  const free = (o: OfferingSpec, weekday: number, period: number, length: 1 | 2) => {
    for (let p = period; p < period + length; p++) {
      if (sectionBusy.has(`${o.sectionCode}|${weekday}|${p}`)) return false;
      if (o.facultyName && facultyBusy.has(`${o.facultyName}|${weekday}|${p}`)) return false;
    }
    return true;
  };

  const key = (o: OfferingSpec) => `${o.sectionCode}/${o.courseCode}`;
  const pinnedCount = new Map<string, number>();
  for (const pin of PINNED) {
    const o = offerings.find((x) => key(x) === pin.key);
    if (!o) continue;
    place(o, catalogue.get(o.courseCode)!, pin.weekday, pin.period, 1);
    pinnedCount.set(pin.key, (pinnedCount.get(pin.key) ?? 0) + 1);
  }

  const bySection = new Map<string, OfferingSpec[]>();
  for (const o of offerings) bySection.set(o.sectionCode, [...(bySection.get(o.sectionCode) ?? []), o]);

  for (const sectionCode of [...bySection.keys()].sort()) {
    // Doubles first (they are the hardest to fit), then singles; each offering's sessions on distinct days.
    const demands = bySection
      .get(sectionCode)!
      .flatMap((o) => {
        const course = catalogue.get(o.courseCode)!;
        return weeklySessions(course)
          .slice(pinnedCount.get(key(o)) ?? 0)
          .map((length) => ({ o, course, length }));
      })
      .sort((a, b) => b.length - a.length || a.o.courseCode.localeCompare(b.o.courseCode));
    const daysUsed = new Map<string, Set<number>>();
    for (const slot of out.filter((s) => s.sectionCode === sectionCode))
      daysUsed.set(slot.courseCode, (daysUsed.get(slot.courseCode) ?? new Set()).add(slot.weekday));

    for (const { o, course, length } of demands) {
      const used = daysUsed.get(o.courseCode) ?? new Set<number>();
      const rotate = hash(key(o)) % TEACHING_DAYS.length;
      const days = TEACHING_DAYS.map((_, i) => TEACHING_DAYS[(i + rotate) % TEACHING_DAYS.length]!);
      const periods = length === 2 ? DOUBLE_STARTS : PERIODS.map((_, i) => i);
      const load = (d: number) => out.filter((s) => s.sectionCode === sectionCode && s.weekday === d).length;
      const candidates = days
        .flatMap((d) => periods.map((p) => ({ d, p })))
        .filter(({ d, p }) => free(o, d, p, length))
        .sort((a, b) => Number(used.has(a.d)) - Number(used.has(b.d)) || load(a.d) - load(b.d));
      const pick = candidates[0];
      if (!pick) throw new Error(`Timetable: no free slot for ${key(o)}`);
      place(o, course, pick.d, pick.p, length);
      daysUsed.set(o.courseCode, used.add(pick.d));
    }
  }
  return out.sort(
    (a, b) =>
      a.sectionCode.localeCompare(b.sectionCode) ||
      a.weekday - b.weekday ||
      a.startsAt.localeCompare(b.startsAt),
  );
}

export const TIMETABLE: readonly SlotSpec[] = build(currentTermOfferings());
