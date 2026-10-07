import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { deliverAt } from "./quiet-hours";

/*
 * The notification layer (ADR-023). Domains queue external messages here in the same transaction as the change that
 * caused them; the dispatcher sends what is due through a transport. Until a provider is configured (Phase 11) the
 * transport is "log": the message is recorded as sent without leaving the system, which keeps the synthetic demo
 * from ever emailing anyone.
 */

type Db = NeonHttpDatabase<typeof s>;

export interface OutgoingEmail {
  recipientKind: "student" | "guardian" | "staff";
  studentId?: string | null;
  userId?: string | null;
  toName: string;
  toAddress: string | null;
  subject: string;
  body: string;
}

/** Outbox rows for one source: held until 07:00 during quiet hours unless urgent; suppressed without an address. */
export function outboxRows(
  tenantId: string,
  source: { type: "announcement" | "reminder" | "guardian_message"; id: string },
  emails: readonly OutgoingEmail[],
  now: Date,
  urgent: boolean,
): (typeof s.notificationOutbox.$inferInsert)[] {
  const release = deliverAt(now, urgent);
  const held = release.getTime() > now.getTime();
  return emails.map((e) => ({
    tenantId,
    channel: "email" as const,
    recipientKind: e.recipientKind,
    studentId: e.studentId ?? null,
    userId: e.userId ?? null,
    toName: e.toName,
    toAddress: e.toAddress,
    subject: e.subject,
    body: e.body,
    sourceType: source.type,
    sourceId: source.id,
    status: e.toAddress ? (held ? ("held" as const) : ("queued" as const)) : ("suppressed" as const),
    notBefore: release,
    createdAt: now,
  }));
}

export interface Transport {
  name: string;
  send(message: { to: string; toName: string; subject: string; body: string }): Promise<void>;
}

/** Records messages as delivered without sending them. The only transport until a provider is configured. */
export const logTransport: Transport = {
  name: "log",
  async send() {},
};

/** Personal in-app notifications, written in the caller's transaction. */
export function notificationRows(
  tenantId: string,
  userIds: readonly (string | null | undefined)[],
  n: { kind: string; title: string; body: string; href?: string },
  at: Date,
): (typeof s.userNotification.$inferInsert)[] {
  return [...new Set(userIds.filter((u): u is string => !!u))].map((userId) => ({
    tenantId,
    userId,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href ?? null,
    createdAt: at,
  }));
}

export const DISPATCH_BATCH = 200;

/**
 * Sends a tenant's due messages (queued or held, `notBefore` reached), oldest first, up to one batch. Each message is
 * marked sent or failed individually; a failed message keeps its error and is retried on the next run (up to 3 tries).
 */
export async function dispatchDue(db: Db, tenantId: string, now: Date, transport: Transport = logTransport) {
  const [due] = await withTenant(db, tenantId, (q) => [
    q
      .select({
        id: s.notificationOutbox.id,
        toAddress: s.notificationOutbox.toAddress,
        toName: s.notificationOutbox.toName,
        subject: s.notificationOutbox.subject,
        body: s.notificationOutbox.body,
        attempts: s.notificationOutbox.attempts,
      })
      .from(s.notificationOutbox)
      .where(
        and(
          inArray(s.notificationOutbox.status, ["queued", "held", "failed"]),
          lte(s.notificationOutbox.notBefore, now),
          sql`${s.notificationOutbox.attempts} < 3`,
        ),
      )
      .orderBy(asc(s.notificationOutbox.notBefore))
      .limit(DISPATCH_BATCH),
  ]);
  const sent: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const m of due) {
    try {
      await transport.send({ to: m.toAddress!, toName: m.toName, subject: m.subject, body: m.body });
      sent.push(m.id);
    } catch (err) {
      failed.push({ id: m.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (sent.length > 0 || failed.length > 0) {
    await withTenant(db, tenantId, (q) => {
      const statements: BatchItem<"pg">[] = failed.map((f) =>
        q
          .update(s.notificationOutbox)
          .set({
            status: "failed",
            transport: transport.name,
            attempts: sql`${s.notificationOutbox.attempts} + 1`,
            lastError: f.error.slice(0, 500),
          })
          .where(eq(s.notificationOutbox.id, f.id)),
      );
      if (sent.length > 0)
        statements.push(
          q
            .update(s.notificationOutbox)
            .set({
              status: "sent",
              sentAt: now,
              transport: transport.name,
              attempts: sql`${s.notificationOutbox.attempts} + 1`,
              lastError: null,
            })
            .where(inArray(s.notificationOutbox.id, sent)),
        );
      return statements as [BatchItem<"pg">, ...BatchItem<"pg">[]];
    });
  }
  return { sent: sent.length, failed: failed.length, remaining: due.length === DISPATCH_BATCH };
}
