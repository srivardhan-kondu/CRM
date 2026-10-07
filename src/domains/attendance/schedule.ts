import { datesBetween, weekdayOf } from "./calendar";

/*
 * Expected sessions: the timetable expanded over dates, minus holidays. A session is "unmarked" when it was expected
 * on or before today and no class_session row records it (held or not held). Pure.
 */

export interface SlotRef {
  id: string;
  offeringId: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  room: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface Occurrence {
  offeringId: string;
  slotId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  room: string;
}

export const sessionKey = (s: { offeringId: string; date: string; startsAt: string }) =>
  `${s.offeringId}|${s.date}|${s.startsAt}`;

/** Every timetabled meeting between two dates (inclusive), by date then time. */
export function occurrences(
  slots: readonly SlotRef[],
  holidays: ReadonlySet<string>,
  from: string,
  to: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  const byWeekday = new Map<number, SlotRef[]>();
  for (const s of slots) byWeekday.set(s.weekday, [...(byWeekday.get(s.weekday) ?? []), s]);
  for (const date of datesBetween(from, to)) {
    if (holidays.has(date)) continue;
    for (const s of byWeekday.get(weekdayOf(date)) ?? []) {
      if (date < s.effectiveFrom || (s.effectiveTo && date > s.effectiveTo)) continue;
      out.push({
        offeringId: s.offeringId,
        slotId: s.id,
        date,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        room: s.room,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt));
}

/** Expected meetings with no recorded session, oldest first. */
export function unmarked(expected: readonly Occurrence[], recorded: ReadonlySet<string>): Occurrence[] {
  return expected.filter((o) => !recorded.has(sessionKey(o)));
}
