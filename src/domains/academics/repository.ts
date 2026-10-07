import "server-only";

import { cache } from "react";
import { getDb } from "@/db/client";
import type { Authed } from "@/lib/authz/context";
import { coversUnit } from "@/lib/authz/engine";
import type { AuthContext, OrgTree } from "@/lib/authz/types";
import { holdsAnywhere } from "@/lib/authz/engine";
import { canAllocate, canManageAt, canViewAcademics, canViewFacultyIn } from "./guards";
import {
  loadOfferingPlanInputs,
  loadCourses,
  loadFaculty,
  loadOfferings,
  loadProgrammes,
  loadRegulationCourses,
  loadRolePermissions,
  loadTerms,
  type OfferingRow,
  type TermRow,
} from "./load";
import { planOfferings } from "./plan";

/*
 * Academic structure reads, cached per request and filtered by the academics guards. Functions return null when
 * the viewer may not read the module at all, so pages can render a permission state instead of an empty list.
 */

const terms = cache((tenantId: string) => loadTerms(getDb(), tenantId));
const programmes = cache((tenantId: string) => loadProgrammes(getDb(), tenantId));
const courses = cache((tenantId: string) => loadCourses(getDb(), tenantId));
const offerings = cache((tenantId: string, termId: string) => loadOfferings(getDb(), tenantId, termId));
const faculty = cache((tenantId: string, termId: string | null) => loadFaculty(getDb(), tenantId, termId));
const facultyPermissions = cache((tenantId: string) => loadRolePermissions(getDb(), tenantId, "faculty"));

/** Terms, plus the one being viewed: `?term=CODE` if it exists, else the current term. */
export async function termContext(authed: Authed, code?: string | null) {
  const all = await terms(authed.ctx.tenantId);
  const term = all.find((t) => t.code === code) ?? all.find((t) => t.isCurrent) ?? all.at(-1) ?? null;
  return { terms: all, term };
}

export async function listProgrammes(authed: Authed) {
  if (!canViewAcademics(authed.ctx)) return null;
  return (await programmes(authed.ctx.tenantId)).map((p) => ({
    ...p,
    manageable: canManageAt(authed.ctx, authed.tree, p.departmentId),
  }));
}

export async function getProgramme(authed: Authed, code: string) {
  const list = await listProgrammes(authed);
  const programme = list?.find((p) => p.code === code);
  if (!programme) return null;
  const rows = await loadRegulationCourses(getDb(), authed.ctx.tenantId, programme.id);
  return { programme, courses: rows };
}

export async function listCourses(authed: Authed) {
  if (!canViewAcademics(authed.ctx)) return null;
  return courses(authed.ctx.tenantId);
}

/** Org units where the viewer may create courses (departments and schools their academics:manage covers). */
export function courseOwnerOptions({ ctx, tree }: Authed) {
  return [...tree.byId.values()]
    .filter((u) => (u.type === "department" || u.type === "school") && canManageAt(ctx, tree, u.id))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Sections a staff assignment holding the permission covers (subtree or the unit itself). */
export function sectionInScope(ctx: AuthContext, tree: OrgTree, sectionId: string, permission: string) {
  const unit = tree.byId.get(sectionId);
  return (
    !!unit &&
    ctx.assignments.some(
      (a) => a.scopeMode !== "linked" && a.permissions.has(permission) && coversUnit(a, unit, tree),
    )
  );
}

export interface OfferingView extends OfferingRow {
  departmentCode: string;
  canAllocate: boolean;
}

/**
 * A term's offerings in the viewer's scope (or the whole tenant with `all`), each flagged with whether the viewer
 * may change its allocation.
 */
export async function listOfferings(authed: Authed, termId: string, opts: { all?: boolean } = {}) {
  const { ctx, tree } = authed;
  if (!canViewAcademics(ctx)) return null;
  const [rows, perms] = await Promise.all([
    offerings(ctx.tenantId, termId),
    facultyPermissions(ctx.tenantId),
  ]);
  return rows
    .filter((o) => opts.all || sectionInScope(ctx, tree, o.sectionId, "academics:view"))
    .map((o): OfferingView => ({
      ...o,
      departmentCode: (o.sectionParentId && tree.byId.get(o.sectionParentId)?.code) || "—",
      canAllocate: canAllocate(ctx, tree, {
        sectionId: o.sectionId,
        targetUserId: "",
        facultyPermissions: perms,
      }).ok,
    }));
}

/** Faculty whose home department the viewer may see, with load in the given term. */
export async function listFaculty(authed: Authed, termId: string | null) {
  const { ctx, tree } = authed;
  const rows = await faculty(ctx.tenantId, termId);
  const visible = rows.filter((f) => canViewFacultyIn(ctx, tree, f.departmentId));
  if (visible.length === 0 && !ctx.assignments.some((a) => a.permissions.has("faculty:view"))) return null;
  return visible;
}

/** Candidates for allocation: active faculty anywhere in the tenant (cross-department teaching is normal). */
export async function allocationCandidates(authed: Authed, termId: string) {
  const rows = await faculty(authed.ctx.tenantId, termId);
  return rows
    .filter((f) => f.status === "active" && f.userId !== authed.ctx.userId)
    .map((f) => ({
      userId: f.userId,
      name: f.name,
      departmentCode: f.departmentCode,
      designation: f.designation,
      hours: f.hours,
      maxWeeklyHours: f.maxWeeklyHours,
    }));
}

/** The viewer's own allocations in a term — My Courses. */
export async function myTeaching(authed: Authed, termId: string) {
  const rows = await offerings(authed.ctx.tenantId, termId);
  return rows.filter((o) => o.allocations.some((a) => a.userId === authed.ctx.userId));
}

export async function getOffering(authed: Authed, termId: string, offeringId: string) {
  return (await offerings(authed.ctx.tenantId, termId)).find((o) => o.id === offeringId) ?? null;
}

/**
 * How many offerings "Generate offerings" would create per term, limited to sections the viewer manages — so the
 * button can state its effect before it is pressed. Empty when the viewer manages nothing.
 */
export async function pendingOfferings(
  authed: Authed,
  terms: readonly TermRow[],
): Promise<Map<string, number>> {
  const { ctx, tree } = authed;
  const out = new Map<string, number>();
  if (!holdsAnywhere(ctx, "academics:manage")) return out;
  for (const t of terms) {
    const inputs = await loadOfferingPlanInputs(getDb(), ctx.tenantId, t.id);
    out.set(t.id, planOfferings({ term: t, ...inputs }, (id) => canManageAt(ctx, tree, id)).length);
  }
  return out;
}
