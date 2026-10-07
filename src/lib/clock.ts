import "server-only";

import { localNow, type LocalNow } from "@/domains/attendance/calendar";
import { DEMO_NOW } from "@/lib/demo/base";
import { demoModeEnabled } from "@/lib/env";

/**
 * The institution's "now" for business rules (marking windows, SLAs, leave dates) and the business timestamps they
 * record. A demo deployment lives at DEMO_NOW, the synthetic institution's reference moment, so its seeded calendar
 * stays coherent on any day; every other deployment uses real time. Audit events always carry real time.
 */
export function institutionNow(): Date {
  return demoModeEnabled() ? new Date(DEMO_NOW) : new Date();
}

/** Today's date and wall-clock time in the institution's zone. */
export function institutionToday(): LocalNow {
  return localNow(institutionNow());
}
