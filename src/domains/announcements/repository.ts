import "server-only";

import { sql } from "drizzle-orm";
import { cache } from "react";
import { z } from "zod";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { linkedStudents } from "@/domains/students/repository";
import type { DepartmentCode } from "@/domains/org/types";
import type { Student } from "@/domains/students/types";
import type { Authed } from "@/lib/authz/context";
import { descendantsOfType } from "@/lib/authz/org-tree";
import type { OrgNode } from "@/lib/authz/types";
import { institutionNow } from "@/lib/clock";
import { canApprove, canManageNotice, authorityAt } from "./guards";
import {
  loadAnnouncement,
  loadAttachment,
  loadAuthored,
  loadBookmarks,
  loadByStatus,
  loadEngagement,
  loadPublished,
  loadReceipts,
  loadRecipientStudents,
  type AnnouncementRecord,
  type RecipientStudent,
} from "./load";
import { audienceUnit, type Authority } from "./rules";
import type { AudienceGroup, AudienceRule, InboxItem, InboxView } from "./types";
import {
  includes,
  inView,
  isVisibleTo,
  recipientKeys,
  sortFeed,
  targetsStudent,
  type Viewer,
} from "./visibility";

/*
 * Announcement reads. Notices come from Neon under RLS; visibility is decided per notice against the viewer's scope
 * and linked students, so an out-of-audience notice is indistinguishable from one that does not exist.
 */

const db = () => getDb();

export async function viewerFor(authed: Authed): Promise<Viewer> {
  const { ctx, tree } = authed;
  const staffUnits = ctx.assignments
    .filter((a) => a.scopeMode !== "linked" && a.permissions.has("announcement:view"))
    .map((a) => tree.byId.get(a.orgUnitId))
    .filter((u): u is OrgNode => !!u);
  // Linked students are read from their current record, so a section transfer changes what they receive.
  const reads = (relation: "self" | "guardian") =>
    ctx.assignments.some(
      (a) =>
        a.scopeMode === "linked" &&
        a.permissions.has("announcement:view") &&
        (a.roleKey === "parent") === (relation === "guardian"),
    )
      ? linkedStudents(authed, relation)
      : Promise.resolve([]);
  const [self, guardian] = await Promise.all([reads("self"), reads("guardian")]);
  const linked = (relation: "self" | "guardian", list: { student: Student }[]) =>
    list.map(({ student: st }) => ({
      id: st.id,
      departmentCode: st.departmentCode,
      year: st.year,
      sectionId: st.sectionId,
      relation,
    }));
  return { tree, staffUnits, students: [...linked("self", self), ...linked("guardian", guardian)] };
}

const viewerCache = cache(viewerFor);

/** Everything the viewer can see, with their own read, acknowledgement and bookmark state. Loaded once per request. */
const inbox = cache(async (authed: Authed): Promise<InboxItem[]> => {
  const { ctx } = authed;
  const viewer = await viewerCache(authed);
  const published = await loadPublished(db(), ctx.tenantId);
  const visible = published.filter((a) => isVisibleTo(a.audience, viewer));
  const keysByNotice = new Map(visible.map((a) => [a.id, recipientKeys(a.audience, viewer, ctx.userId)]));
  const allKeys = [...new Set([...keysByNotice.values()].flat())];
  const [receipts, saved] = await Promise.all([
    loadReceipts(db(), ctx.tenantId, allKeys),
    loadBookmarks(db(), ctx.tenantId, ctx.userId),
  ]);
  const byNotice = new Map<string, typeof receipts>();
  for (const r of receipts) {
    const list = byNotice.get(r.announcementId) ?? [];
    list.push(r);
    byNotice.set(r.announcementId, list);
  }
  return sortFeed(
    visible.map((a) => {
      const keys = keysByNotice.get(a.id) ?? [];
      const mine = (byNotice.get(a.id) ?? []).filter((r) => keys.includes(r.recipientKey));
      return {
        ...a,
        addressed: keys.length > 0,
        read: mine.some((r) => r.readAt !== null),
        acknowledged: mine.some((r) => r.acknowledgedAt !== null),
        saved: saved.has(a.id),
      };
    }),
  );
});

export async function listInbox(authed: Authed, view: InboxView): Promise<InboxItem[]> {
  const now = institutionNow();
  return (await inbox(authed)).filter((a) => inView(a, view, now));
}

export async function inboxCounts(authed: Authed): Promise<Record<InboxView, number>> {
  const items = await inbox(authed);
  const now = institutionNow();
  const views: InboxView[] = ["today", "mine", "exams", "jobs", "saved", "history"];
  return Object.fromEntries(views.map((v) => [v, items.filter((a) => inView(a, v, now)).length])) as Record<
    InboxView,
    number
  >;
}

/** Out-of-audience ids resolve to null, exactly like unknown ids. */
export async function getInboxItem(authed: Authed, id: string): Promise<InboxItem | null> {
  return (await inbox(authed)).find((a) => a.id === id) ?? null;
}

/** The receipt keys the viewer holds on a notice — what reading or acknowledging it updates. */
export async function myKeysFor(authed: Authed, rule: AudienceRule): Promise<string[]> {
  return recipientKeys(rule, await viewerCache(authed), authed.ctx.userId);
}

/** Active notices addressed to a student (shown on Student 360), independent of who is looking. */
export async function noticesForStudent(authed: Authed, student: Student) {
  const now = institutionNow();
  const placement = {
    departmentCode: student.departmentCode,
    year: student.year,
    sectionId: student.sectionId,
  };
  return (await loadPublishedCached(authed.ctx.tenantId)).filter(
    (a) =>
      targetsStudent(a.audience, placement) &&
      includes(a.audience, "students") &&
      (a.expiresAt === null || new Date(a.expiresAt) > now),
  );
}

const loadPublishedCached = cache((tenantId: string) => loadPublished(db(), tenantId));

/* ---------- Authoring ---------- */

export async function authoredNotices(authed: Authed): Promise<AnnouncementRecord[]> {
  return loadAuthored(db(), authed.ctx.tenantId, authed.ctx.userId);
}

/** A notice the viewer wrote or may manage (any state), for editing drafts and the engagement panel. */
export async function managedNotice(authed: Authed, id: string): Promise<AnnouncementRecord | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const a = await loadAnnouncement(db(), authed.ctx.tenantId, id);
  if (!a) return null;
  return canManageNotice(authed.ctx, authed.tree, a) ? a : null;
}

/** Pending notices the viewer may decide (not their own), oldest first. */
export async function pendingForApproval(authed: Authed): Promise<(AnnouncementRecord & { reach: Reach })[]> {
  if (!authed.ctx.assignments.some((a) => a.permissions.has("announcement:approve"))) return [];
  const pending = (await loadByStatus(db(), authed.ctx.tenantId, "pending")).filter((a) =>
    canApprove(authed.ctx, authed.tree, a),
  );
  if (pending.length === 0) return [];
  const students = await recipientStudentsCached(authed.ctx.tenantId);
  return pending
    .map((a) => ({ ...a, reach: reachOf(a.audience, students) }))
    .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
}

const recipientStudentsCached = cache((tenantId: string) => loadRecipientStudents(db(), tenantId));

export function recipientStudents(authed: Authed) {
  return recipientStudentsCached(authed.ctx.tenantId);
}

export interface Reach {
  students: number;
  guardians: number;
  /** Recipients the email channel can reach (an address on record). */
  studentEmails: number;
  guardianEmails: number;
  staff: boolean;
}

export function reachOf(rule: AudienceRule, students: readonly RecipientStudent[]): Reach {
  const targeted = students.filter((st) => targetsStudent(rule, st));
  const toStudents = includes(rule, "students");
  const toGuardians = includes(rule, "guardians");
  const withGuardian = targeted.filter((st) => st.guardianName !== null);
  return {
    students: toStudents ? targeted.length : 0,
    guardians: toGuardians ? withGuardian.length : 0,
    studentEmails: toStudents ? targeted.length : 0,
    guardianEmails: toGuardians ? withGuardian.filter((st) => st.guardianEmail).length : 0,
    staff: includes(rule, "staff"),
  };
}

/** A target the composer offers: where the author may publish, what they hold there, and how many it reaches. */
export interface TargetOption {
  key: string;
  label: string;
  group: "Institution" | "Departments" | "Years" | "Sections";
  authority: Authority;
  students: number;
  guardians: number;
  guardianEmails: number;
}

export function targetKey(rule: AudienceRule): string {
  switch (rule.kind) {
    case "institution":
      return "institution";
    case "department":
      return `department:${rule.departmentCode}`;
    case "year":
      return `year:${rule.departmentCode}:${rule.year}`;
    case "section":
      return `section:${rule.sectionId}`;
    case "placement_eligible":
      return `placement:${rule.departmentCodes.join(",")}:${rule.year}`;
  }
}

/** Targets the user may publish to: the institution, departments, department years and sections. */
export async function composerTargets(authed: Authed): Promise<TargetOption[]> {
  const { ctx, tree } = authed;
  const students = await recipientStudentsCached(ctx.tenantId);
  const out: TargetOption[] = [];
  const add = (group: TargetOption["group"], label: string, rule: AudienceRule) => {
    const unit = audienceUnit(rule, tree);
    if (!unit) return;
    const authority = authorityAt(ctx, tree, unit.id);
    if (!authority.publish) return;
    const targeted = students.filter((st) => targetsStudent(rule, st));
    out.push({
      key: targetKey(rule),
      label,
      group,
      authority,
      students: targeted.length,
      guardians: targeted.filter((st) => st.guardianName !== null).length,
      guardianEmails: targeted.filter((st) => st.guardianEmail).length,
    });
  };
  add("Institution", tree.root.name, { kind: "institution", audience: "everyone" });
  const departments = descendantsOfType(tree, tree.root, "department");
  for (const d of departments)
    add("Departments", d.name, {
      kind: "department",
      departmentCode: d.code as DepartmentCode,
      audience: "everyone",
    });
  for (const d of departments) {
    const years = [
      ...new Set(students.filter((st) => st.departmentCode === d.code).map((st) => st.year)),
    ].sort();
    for (const year of years)
      add("Years", `${d.code} · year ${year}`, {
        kind: "year",
        departmentCode: d.code as DepartmentCode,
        year,
        audience: "everyone",
      });
  }
  for (const sec of descendantsOfType(tree, tree.root, "section"))
    add("Sections", sec.name, { kind: "section", sectionId: sec.code, audience: "everyone" });
  return out;
}

/** Turns a composer target key and audience group back into a rule. Unknown units are rejected by the caller. */
export function ruleFromKey(key: string, audience: AudienceGroup): AudienceRule | null {
  const [kind, a, b] = key.split(":");
  if (kind === "institution") return { kind: "institution", audience };
  if (kind === "department" && a)
    return { kind: "department", departmentCode: a as DepartmentCode, audience };
  if (kind === "year" && a && b && /^\d$/.test(b))
    return { kind: "year", departmentCode: a as DepartmentCode, year: Number(b), audience };
  if (kind === "section" && a) return { kind: "section", sectionId: a, audience };
  return null;
}

export interface EngagementView {
  students: { delivered: number; read: number; acknowledged: number };
  guardians: { delivered: number; read: number; acknowledged: number };
  staff: { read: number; acknowledged: number };
  sections: { code: string; delivered: number; read: number; acknowledged: number }[];
  pending: {
    studentNumber: string;
    name: string;
    sectionCode: string;
    kind: "student" | "guardian";
    read: boolean;
  }[];
  pendingTotal: number;
  email: Partial<Record<"queued" | "held" | "sent" | "failed" | "suppressed", number>>;
}

/** Reach and response for a notice the viewer manages; null otherwise. */
export async function engagementFor(authed: Authed, a: AnnouncementRecord): Promise<EngagementView | null> {
  if (!canManageNotice(authed.ctx, authed.tree, a) || a.status === "draft") return null;
  const e = await loadEngagement(db(), authed.ctx.tenantId, a.id);
  const sum = (kind: "student" | "guardian" | "staff") =>
    e.rows
      .filter((r) => r.kind === kind)
      .reduce(
        (acc, r) => ({
          delivered: acc.delivered + r.delivered,
          read: acc.read + r.read,
          acknowledged: acc.acknowledged + r.acknowledged,
        }),
        { delivered: 0, read: 0, acknowledged: 0 },
      );
  const sections = new Map<string, { code: string; delivered: number; read: number; acknowledged: number }>();
  for (const r of e.rows) {
    if (r.kind !== "student" || !r.sectionCode) continue;
    sections.set(r.sectionCode, {
      code: r.sectionCode,
      delivered: r.delivered,
      read: r.read,
      acknowledged: r.acknowledged,
    });
  }
  const staff = sum("staff");
  return {
    students: sum("student"),
    guardians: sum("guardian"),
    staff: { read: staff.read, acknowledged: staff.acknowledged },
    sections: [...sections.values()].sort((x, y) => x.code.localeCompare(y.code)),
    pending: e.pending
      .filter((p): p is typeof p & { kind: "student" | "guardian" } => p.kind !== "staff")
      .slice(0, 60)
      .map((p) => ({
        studentNumber: p.studentNumber,
        name: p.name,
        sectionCode: p.sectionCode,
        kind: p.kind,
        read: p.read,
      })),
    pendingTotal: e.pending.length,
    email: e.email,
  };
}

/**
 * An attachment the viewer may download: of a published notice they can see, or of a notice they manage (author or
 * approver, any state). Anything else is null — the route answers 404 either way.
 */
export async function attachmentFor(authed: Authed, announcementId: string, attachmentId: string) {
  if (!z.uuid().safeParse(announcementId).success || !z.uuid().safeParse(attachmentId).success) return null;
  const visible = await getInboxItem(authed, announcementId);
  const allowed = visible ?? (await managedNotice(authed, announcementId));
  if (!allowed) return null;
  return loadAttachment(db(), authed.ctx.tenantId, announcementId, attachmentId);
}

/** Records that the viewer opened a notice (first read only). Runs after the response; failures are logged. */
export async function recordRead(authed: Authed, item: InboxItem): Promise<void> {
  if (!item.addressed || item.read) return;
  const keys = await myKeysFor(authed, item.audience);
  const at = institutionNow();
  await withTenant(db(), authed.ctx.tenantId, (q) => [
    q
      .insert(s.announcementReceipt)
      .values(keys.map((key) => receiptValues(authed, item.id, key, at, { read: true })))
      .onConflictDoUpdate({
        target: [s.announcementReceipt.announcementId, s.announcementReceipt.recipientKey],
        set: { readAt: sql`coalesce(${s.announcementReceipt.readAt}, excluded.read_at)` },
      }),
  ]);
}

export function receiptValues(
  authed: Authed,
  announcementId: string,
  key: string,
  at: Date,
  state: { read?: boolean; acknowledged?: boolean },
): typeof s.announcementReceipt.$inferInsert {
  const [prefix, id] = key.split(":") as ["u" | "s" | "g", string];
  return {
    tenantId: authed.ctx.tenantId,
    announcementId,
    recipientKey: key,
    kind: prefix === "u" ? "staff" : prefix === "s" ? "student" : "guardian",
    studentId: prefix === "u" ? null : id,
    userId: prefix === "u" ? id : null,
    deliveredAt: at,
    readAt: state.read || state.acknowledged ? at : null,
    acknowledgedAt: state.acknowledged ? at : null,
  };
}
