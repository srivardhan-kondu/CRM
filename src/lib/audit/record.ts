import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { auditEvent } from "@/db/schema";

export interface AuditInput {
  tenantId: string | null;
  actorUserId: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "denied" | "failure";
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Request metadata for audit rows; tolerant of being called outside a request (e.g. auth hooks, scripts). */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return {
      ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

export async function auditValues(input: AuditInput) {
  const meta = await requestMeta();
  return {
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
    ...meta,
  };
}

/**
 * Append an audit event and return its id. For mutations, prefer building the row with `auditValues` and
 * writing it in the same `db.batch` as the change so the two commit together.
 */
export async function recordAudit(input: AuditInput): Promise<string> {
  const values = await auditValues(input);
  await getDb().insert(auditEvent).values(values);
  return values.id;
}

/**
 * Background variant for reads, so audit latency never blocks a page. Scheduled with `after()` so the write
 * completes even on serverless platforms after the response is sent. Failures are logged, never swallowed.
 */
export function recordAuditInBackground(input: AuditInput): void {
  const run = () =>
    recordAudit(input).catch((err) => console.error("[audit] failed to record", input.action, err));
  try {
    after(run);
  } catch {
    void run();
  }
}
