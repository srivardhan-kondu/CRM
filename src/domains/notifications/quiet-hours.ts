/*
 * Quiet hours (ADR-023): email and other external messages that are not urgent are held between 21:00 and 07:00
 * institution time and leave at 07:00. In-app delivery is never held. India has no daylight saving, so the
 * institution's offset is fixed.
 */

export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 7;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function localHour(at: Date): number {
  return new Date(at.getTime() + IST_OFFSET_MS).getUTCHours();
}

export function inQuietHours(at: Date): boolean {
  const h = localHour(at);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** When an external message created at `at` may leave: now if urgent or outside quiet hours, else the next 07:00. */
export function deliverAt(at: Date, urgent: boolean): Date {
  if (urgent || !inQuietHours(at)) return at;
  const local = new Date(at.getTime() + IST_OFFSET_MS);
  const release = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), QUIET_END_HOUR);
  // Before midnight the release is tomorrow morning; after midnight it is this morning.
  const day = local.getUTCHours() >= QUIET_START_HOUR ? 24 * HOUR : 0;
  return new Date(release + day - IST_OFFSET_MS);
}
