import "server-only";

import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db/client";
import * as s from "@/db/schema";
import type { Authed } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import { notificationRows } from "./outbox";

/**
 * Statements notifying one user in the app, to spread into the caller's transaction: nothing when there is nobody to
 * tell (a seeded request without an account) or when the user would be told about their own action.
 */
export function notify(
  q: ReturnType<typeof getDb>,
  authed: Authed,
  userId: string | null | undefined,
  n: { kind: string; title: string; body: string; href?: string },
): BatchItem<"pg">[] {
  if (!userId || userId === authed.ctx.userId) return [];
  return [
    q.insert(s.userNotification).values(notificationRows(authed.ctx.tenantId, [userId], n, institutionNow())),
  ];
}
