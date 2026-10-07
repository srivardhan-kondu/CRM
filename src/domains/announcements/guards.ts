import { authorize } from "@/lib/authz/engine";
import type { AuthContext, OrgTree, StudentRef } from "@/lib/authz/types";
import type { Authority } from "./rules";

/*
 * Who may do what with notices and guardian messages. Pure policy over the engine; services check before every change
 * and pages use the same functions to decide what to offer.
 */

const atUnit = (ctx: AuthContext, tree: OrgTree, permission: string, orgUnitId: string) =>
  authorize(ctx, tree, permission, { kind: "org_unit", tenantId: ctx.tenantId, orgUnitId }).allowed;

/** What the user holds over a target unit — the input to `publishRoute`. */
export function authorityAt(ctx: AuthContext, tree: OrgTree, orgUnitId: string): Authority {
  return {
    publish: atUnit(ctx, tree, "announcement:publish", orgUnitId),
    approve: atUnit(ctx, tree, "announcement:approve", orgUnitId),
    guardians: atUnit(ctx, tree, "guardian:message", orgUnitId),
  };
}

/** Decide someone else's pending notice: `announcement:approve` over its target, and not the author. */
export function canApprove(
  ctx: AuthContext,
  tree: OrgTree,
  notice: { authorId: string | null; audienceUnitId: string },
): boolean {
  return notice.authorId !== ctx.userId && atUnit(ctx, tree, "announcement:approve", notice.audienceUnitId);
}

/** Reach, read and acknowledgement figures, reminders and withdrawal: the author, or an approver for the target. */
export function canManageNotice(
  ctx: AuthContext,
  tree: OrgTree,
  notice: { authorId: string | null; audienceUnitId: string },
): boolean {
  return notice.authorId === ctx.userId || atUnit(ctx, tree, "announcement:approve", notice.audienceUnitId);
}

/** Message a student's guardians. */
export const canMessageGuardiansOf = (ctx: AuthContext, tree: OrgTree, student: StudentRef) =>
  authorize(ctx, tree, "guardian:message", { kind: "student", student }).allowed;
