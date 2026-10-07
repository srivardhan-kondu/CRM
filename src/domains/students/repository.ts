import "server-only";

import { cache } from "react";
import { z } from "zod";
import { getDb } from "@/db/client";
import { recordAuditInBackground } from "@/lib/audit/record";
import type { Authed } from "@/lib/authz/context";
import { studentFieldAccess } from "@/lib/authz/engine";
import { isWithin } from "@/lib/authz/org-tree";
import type { AuthContext, OrgNode, StudentRef } from "@/lib/authz/types";
import { timelineFor } from "@/lib/demo/fixtures";
import { loadPlacement, loadStudentById, loadStudents, type StudentBundle } from "./load";
import { visibleSubjects, visibleTimeline } from "./projection";
import { queryVisible, type Visible } from "./query";
import { parseScopeKey, scopeKey, studentScope } from "./scope";
import type { Student, StudentQuery, SubjectAttendance, TimelineEvent } from "./types";

/*
 * Student repository. Records come from Neon under row-level security; every read takes the authenticated
 * context and runs the policy engine per record. Loads are cached per request, keyed by tenant and scope.
 */

export function studentRef(s: Student, tenantId: string): StudentRef {
  return { tenantId, studentNumber: s.studentNumber, sectionCode: s.sectionId };
}

const loadScoped = cache((tenantId: string, key: string): Promise<StudentBundle> =>
  loadStudents(getDb(), tenantId, parseScopeKey(key)),
);

function bundleFor({ ctx, tree }: Authed) {
  return loadScoped(ctx.tenantId, scopeKey(studentScope(ctx, tree)));
}

function withAccess(ctx: AuthContext, authed: Authed, students: readonly Student[]): Visible[] {
  const out: Visible[] = [];
  for (const s of students) {
    const access = studentFieldAccess(ctx, authed.tree, studentRef(s, ctx.tenantId));
    if (access.view) out.push({ student: s, access });
  }
  return out;
}

/** All students the user may open, each with per-record field access. */
export async function visibleStudents(authed: Authed): Promise<Visible[]> {
  const bundle = await bundleFor(authed);
  return withAccess(authed.ctx, authed, bundle.students);
}

/** Visible students whose section sits inside `unit` (a workspace's org scope). */
export async function visibleStudentsIn(authed: Authed, unit: OrgNode): Promise<Visible[]> {
  return (await visibleStudents(authed)).filter((v) => {
    const section = authed.tree.byCode.get(v.student.sectionId);
    return section ? isWithin(section, unit) : false;
  });
}

export async function listStudents(authed: Authed, query: StudentQuery) {
  return queryVisible(await visibleStudents(authed), query);
}

export async function searchStudents(authed: Authed, q: string, limit = 8) {
  return queryVisible(await visibleStudents(authed), { q, pageSize: limit }).rows.map((v) => v.student);
}

/** Subject attendance for a visible student, limited to what the viewer may read on that record. */
export async function subjectsFor(authed: Authed, v: Visible): Promise<SubjectAttendance[]> {
  const bundle = await bundleFor(authed);
  return visibleSubjects(bundle.subjects.get(v.student.id) ?? [], v.access);
}

const uuid = z.uuid();

/**
 * Student 360 read. Unknown and out-of-scope ids both return null (no existence leak to the caller), but an
 * out-of-scope attempt on a real record is audited as a denial, and every successful open is audited as a
 * sensitive read.
 */
export async function getStudentDetail(authed: Authed, id: string) {
  const { ctx, tree } = authed;
  if (!uuid.safeParse(id).success) return null;
  const db = getDb();
  const bundle = await loadStudentById(db, ctx.tenantId, id);
  const student = bundle.students[0];
  const row = bundle.rows.get(id);
  if (!student || !row) return null;
  const access = studentFieldAccess(ctx, tree, studentRef(student, ctx.tenantId));
  recordAuditInBackground({
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    actorEmail: ctx.email,
    action: "student.view",
    resourceType: "student",
    resourceId: student.studentNumber,
    outcome: access.view ? "success" : "denied",
    reason: access.view ? undefined : "outside assigned scope",
  });
  if (!access.view) return null;

  const placement = await loadPlacement(db, ctx.tenantId, row);
  // Section moves are part of the record's history; everything else on the timeline is synthetic until the
  // owning domains record real events.
  const moves: TimelineEvent[] = placement.history.map((h, i) => ({
    id: `placement-${h.id}`,
    at: new Date(`${h.startedOn}T09:00:00+05:30`).toISOString(),
    kind: "enrollment",
    title:
      i === placement.history.length - 1
        ? `Admitted to section ${h.sectionLabel}`
        : `Moved to section ${h.sectionLabel}`,
    detail: h.reason,
  }));
  const timeline = [...timelineFor(student), ...moves].sort((a, b) => b.at.localeCompare(a.at));
  return {
    student,
    access,
    placement: {
      ...placement,
      guardians: access.guardian ? placement.guardians : [],
    },
    subjects: visibleSubjects(bundle.subjects.get(id) ?? [], access),
    timeline: visibleTimeline(timeline, access),
  };
}

/** Students linked to the user (self or guardian), in link order — for student and parent workspaces. */
export async function linkedStudents(authed: Authed, relation: "self" | "guardian"): Promise<Visible[]> {
  const numbers = authed.ctx.links.filter((l) => l.relation === relation).map((l) => l.studentNumber);
  return (await visibleStudents(authed)).filter((v) => numbers.includes(v.student.studentNumber));
}

/** Department and section filter options for the students the user can open. */
export async function directoryFacets(authed: Authed) {
  const visible = await visibleStudents(authed);
  const departments = new Map<string, string>();
  const sections = new Map<string, { label: string; departmentCode: string; year: number }>();
  for (const { student: s } of visible) {
    departments.set(s.departmentCode, authed.tree.byCode.get(s.departmentCode)?.name ?? s.departmentCode);
    sections.set(s.sectionId, { label: s.sectionLabel, departmentCode: s.departmentCode, year: s.year });
  }
  return { visible, departments, sections };
}
