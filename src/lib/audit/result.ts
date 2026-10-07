import "server-only";

import { getDb } from "@/db/client";
import { auditEvent } from "@/db/schema";
import type { Authed } from "@/lib/authz/context";
import { auditValues } from "./record";

/** Every mutation returns a human-readable result and the id of the audit event it wrote (PRD §11). */
export type ActionResult = { ok: true; message: string; auditId: string } | { ok: false; error: string };

export const fail = (error: string): ActionResult => ({ ok: false, error });

/** Records a refused mutation as a `denied` audit event and returns the reason to the caller. */
export async function denied(
  authed: Authed,
  action: string,
  resourceType: string,
  reason: string,
  resourceId?: string,
): Promise<ActionResult> {
  const values = await auditValues({
    tenantId: authed.ctx.tenantId,
    actorUserId: authed.ctx.userId,
    actorEmail: authed.ctx.email,
    action,
    resourceType,
    resourceId,
    outcome: "denied",
    reason,
  });
  await getDb().insert(auditEvent).values(values);
  return fail(reason);
}

/** Audit row for a successful change, written in the same transaction as the change. */
export function successAudit(
  authed: Authed,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  return auditValues({
    tenantId: authed.ctx.tenantId,
    actorUserId: authed.ctx.userId,
    actorEmail: authed.ctx.email,
    action,
    resourceType,
    resourceId,
    outcome: "success",
    metadata,
  });
}
