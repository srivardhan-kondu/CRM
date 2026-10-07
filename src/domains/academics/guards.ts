import { authorize, holdsAnywhere, permissionsAt } from "@/lib/authz/engine";
import type { AuthContext, OrgTree } from "@/lib/authz/types";

/*
 * Who may read and change the academic structure. Pure, so the UI can compute what to offer with the same rules
 * the server enforces.
 *
 * - Reading structure (programmes, regulations, catalogue, terms, offerings) needs `academics:view` anywhere in the
 *   tenant: it describes the institution, not people.
 * - Changing it needs `academics:manage` covering the unit it belongs to (a programme's or course owner's
 *   department; a section; the institution for terms).
 * - Allocating faculty needs `teaching:allocate` on the section and, because allocation grants the faculty role's
 *   access there, the same delegation ceiling as granting that role (ADR-012).
 * - Faculty profiles and load need `faculty:view` covering the faculty member's home department.
 */

export type Guard = { ok: true } | { ok: false; reason: string };

const ok: Guard = { ok: true };
const no = (reason: string): Guard => ({ ok: false, reason });

export function canViewAcademics(ctx: AuthContext | null): boolean {
  return holdsAnywhere(ctx, "academics:view");
}

export function canManageAt(ctx: AuthContext | null, tree: OrgTree | null, orgUnitId: string): boolean {
  if (!ctx) return false;
  return authorize(ctx, tree, "academics:manage", { kind: "org_unit", tenantId: ctx.tenantId, orgUnitId })
    .allowed;
}

export function canManageTerms(ctx: AuthContext | null, tree: OrgTree | null): boolean {
  if (!ctx) return false;
  return authorize(ctx, tree, "academics:manage", { kind: "tenant", tenantId: ctx.tenantId }).allowed;
}

export function canViewFacultyIn(
  ctx: AuthContext | null,
  tree: OrgTree | null,
  departmentId: string,
): boolean {
  if (!ctx) return false;
  return authorize(ctx, tree, "faculty:view", {
    kind: "org_unit",
    tenantId: ctx.tenantId,
    orgUnitId: departmentId,
  }).allowed;
}

export function canAllocate(
  ctx: AuthContext,
  tree: OrgTree,
  req: { sectionId: string; targetUserId: string; facultyPermissions: ReadonlySet<string> },
): Guard {
  if (req.targetUserId === ctx.userId)
    return no("You can't change your own teaching allocation. Ask your head of department.");
  const allowed = authorize(ctx, tree, "teaching:allocate", {
    kind: "org_unit",
    tenantId: ctx.tenantId,
    orgUnitId: req.sectionId,
  });
  if (!allowed.allowed) return no("Allocating faculty to this section is outside your scope.");
  const held = permissionsAt(ctx, tree, req.sectionId);
  const missing = [...req.facultyPermissions].filter((p) => !held.has(p));
  if (missing.length)
    return no(`Allocation grants access you don't hold for this section (${missing.join(", ")}).`);
  return ok;
}
