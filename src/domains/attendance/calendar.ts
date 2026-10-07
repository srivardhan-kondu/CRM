/*
 * Institution calendar arithmetic on plain ISO dates ("2026-10-06") and wall-clock times ("09:00"). Attendance
 * rules are about the institution's local day, not the server's, so every conversion from an instant goes
 * through INSTITUTION_TZ. Pure: callers pass "now".
 */

/** Indian institutions keep one civil time. A per-tenant zone can replace this when a tenant needs it. */
export const INSTITUTION_TZ = "Asia/Kolkata";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: INSTITUTION_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: INSTITUTION_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The institution's calendar date of an instant: "2026-10-06". */
export function localDate(at: Date): string {
  return dateFmt.format(at);
}

/** The institution's wall-clock time of an instant: "09:30". */
export function localTime(at: Date): string {
  return timeFmt.format(at);
}

export interface LocalNow {
  date: string;
  time: string;
}

export function localNow(at: Date): LocalNow {
  return { date: localDate(at), time: localTime(at) };
}

const noonUtc = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`);

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(isoDate: string): number {
  return ((noonUtc(isoDate).getUTCDay() + 6) % 7) + 1;
}

export function addDays(isoDate: string, days: number): string {
  const d = noonUtc(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function weekdayName(isoDate: string): string {
  return WEEKDAY_NAMES[weekdayOf(isoDate) - 1]!;
}

/** The instant a local date and time denote, for SLA arithmetic and display ("2026-10-06", "09:00"). */
export function localInstant(isoDate: string, time: string): Date {
  return new Date(`${isoDate}T${time}:00+05:30`);
}

export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(noonUtc(v).getTime());
export const isClockTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
