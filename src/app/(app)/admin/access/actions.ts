"use server";

import { revalidatePath } from "next/cache";
import {
  grantAssignment,
  inviteUser,
  revokeAssignment,
  revokeSessions,
  setMembershipStatus,
  type ActionResult,
} from "@/domains/admin/service";
import { currentAuth } from "@/lib/authz/context";

/*
 * Server actions are public HTTP endpoints: each one re-authenticates and delegates to the domain service, which
 * authorizes, validates, writes the change and its audit event in one transaction, and explains the outcome.
 */

export type FormState = ActionResult | null;

async function run(
  fn: (authed: NonNullable<Awaited<ReturnType<typeof currentAuth>>>) => Promise<ActionResult>,
): Promise<ActionResult> {
  const authed = await currentAuth();
  if (!authed) return { ok: false, error: "Your session has ended. Sign in again." };
  const result = await fn(authed);
  if (result.ok) revalidatePath("/admin/access");
  return result;
}

export async function inviteUserAction(_prev: FormState, form: FormData): Promise<ActionResult> {
  return run((a) => inviteUser(a, { email: form.get("email"), name: form.get("name") }));
}

export async function grantAssignmentAction(_prev: FormState, form: FormData): Promise<ActionResult> {
  return run((a) =>
    grantAssignment(a, {
      userId: form.get("userId"),
      roleId: form.get("roleId"),
      orgUnitId: form.get("orgUnitId"),
      scopeMode: form.get("scopeMode"),
      courseCodes: form.get("courseCodes") ?? "",
      studentNumber: form.get("studentNumber") || undefined,
      validFrom: form.get("validFrom") || undefined,
      validTo: form.get("validTo") ?? "",
    }),
  );
}

export async function revokeAssignmentAction(_prev: FormState, form: FormData): Promise<ActionResult> {
  return run((a) =>
    revokeAssignment(a, { assignmentId: form.get("assignmentId"), reason: form.get("reason") }),
  );
}

export async function setMembershipAction(
  userId: string,
  status: "active" | "suspended",
): Promise<ActionResult> {
  return run((a) => setMembershipStatus(a, { userId, status }));
}

export async function revokeSessionsAction(userId: string): Promise<ActionResult> {
  return run((a) => revokeSessions(a, { userId }));
}
