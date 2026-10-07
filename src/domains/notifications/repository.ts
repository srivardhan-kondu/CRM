import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { successAudit, denied, type ActionResult } from "@/lib/audit/result";
import type { Authed } from "@/lib/authz/context";
import { authorize } from "@/lib/authz/engine";
import { institutionNow } from "@/lib/clock";
import { dispatchDue } from "./outbox";

/* Personal notifications (the bell) and the delivery log of external messages. */

export interface PersonalNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  read: boolean;
}

export const myNotifications = cache(async (tenantId: string, userId: string) => {
  const [rows, unread] = await withTenant(getDb(), tenantId, (q) => [
    q
      .select({
        id: s.userNotification.id,
        kind: s.userNotification.kind,
        title: s.userNotification.title,
        body: s.userNotification.body,
        href: s.userNotification.href,
        createdAt: s.userNotification.createdAt,
        readAt: s.userNotification.readAt,
      })
      .from(s.userNotification)
      .where(eq(s.userNotification.userId, userId))
      .orderBy(desc(s.userNotification.createdAt))
      .limit(8),
    q
      .select({ n: sql<number>`count(*)::int` })
      .from(s.userNotification)
      .where(and(eq(s.userNotification.userId, userId), isNull(s.userNotification.readAt))),
  ]);
  return {
    items: rows.map((r): PersonalNotification => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      href: r.href,
      createdAt: r.createdAt.toISOString(),
      read: r.readAt !== null,
    })),
    unread: unread[0]?.n ?? 0,
  };
});

export async function markNotificationsRead(authed: Authed): Promise<void> {
  await withTenant(getDb(), authed.ctx.tenantId, (q) => [
    q
      .update(s.userNotification)
      .set({ readAt: institutionNow() })
      .where(and(eq(s.userNotification.userId, authed.ctx.userId), isNull(s.userNotification.readAt))),
  ]);
}

/* ---------- Delivery log ---------- */

/** The delivery log shows message content sent to families: institution-wide audit readers only. */
export const canViewDeliveries = ({ ctx, tree }: Authed) =>
  authorize(ctx, tree, "audit:view", { kind: "tenant", tenantId: ctx.tenantId }).allowed;

/** Releasing messages is an integration duty (platform configuration). */
export const canDispatch = ({ ctx, tree }: Authed) =>
  authorize(ctx, tree, "tenant:configure", { kind: "tenant", tenantId: ctx.tenantId }).allowed;

export const OUTBOX_STATUSES = ["queued", "held", "sent", "failed", "suppressed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export async function deliveryLog(authed: Authed, status: OutboxStatus | null) {
  if (!canViewDeliveries(authed)) return null;
  const now = institutionNow();
  const [counts, rows, due] = await withTenant(getDb(), authed.ctx.tenantId, (q) => [
    q
      .select({ status: s.notificationOutbox.status, n: sql<number>`count(*)::int` })
      .from(s.notificationOutbox)
      .groupBy(s.notificationOutbox.status),
    q
      .select({
        id: s.notificationOutbox.id,
        recipientKind: s.notificationOutbox.recipientKind,
        toName: s.notificationOutbox.toName,
        toAddress: s.notificationOutbox.toAddress,
        subject: s.notificationOutbox.subject,
        sourceType: s.notificationOutbox.sourceType,
        status: s.notificationOutbox.status,
        notBefore: s.notificationOutbox.notBefore,
        createdAt: s.notificationOutbox.createdAt,
        sentAt: s.notificationOutbox.sentAt,
        transport: s.notificationOutbox.transport,
        lastError: s.notificationOutbox.lastError,
      })
      .from(s.notificationOutbox)
      .where(status ? eq(s.notificationOutbox.status, status) : sql`true`)
      .orderBy(desc(s.notificationOutbox.createdAt), desc(s.notificationOutbox.id))
      .limit(100),
    q
      .select({ n: sql<number>`count(*)::int` })
      .from(s.notificationOutbox)
      .where(
        sql`${s.notificationOutbox.status} in ('queued', 'held', 'failed') and ${s.notificationOutbox.notBefore} <= ${now} and ${s.notificationOutbox.attempts} < 3`,
      ),
  ]);
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<OutboxStatus, number>>,
    rows,
    due: due[0]?.n ?? 0,
  };
}

export async function dispatchNow(authed: Authed): Promise<ActionResult> {
  if (!canDispatch(authed))
    return denied(
      authed,
      "notification.dispatch",
      "notification_outbox",
      "Only platform administrators release messages.",
    );
  const result = await dispatchDue(getDb(), authed.ctx.tenantId, institutionNow());
  const audit = await successAudit(
    authed,
    "notification.dispatch",
    "notification_outbox",
    authed.ctx.tenantId,
    result,
  );
  await getDb().insert(s.auditEvent).values(audit);
  return {
    ok: true,
    message:
      result.sent + result.failed === 0
        ? "Nothing was due."
        : `${result.sent} sent${result.failed ? `, ${result.failed} failed` : ""}${result.remaining ? " — more are waiting" : ""}.`,
    auditId: audit.id,
  };
}
