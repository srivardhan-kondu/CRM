/** The marking (or review) screen of one class meeting. */
export function markHref(o: { offeringId: string; date: string; startsAt: string }): string {
  return `/attendance/mark/${o.offeringId}?date=${o.date}&start=${o.startsAt}`;
}
