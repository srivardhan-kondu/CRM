import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { getDb } from "@/db/client";
import * as s from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { listInbox, pendingForApproval } from "@/domains/announcements/repository";
import {
  approvalQueue,
  attendanceContext,
  classesOn,
  myOpenSessions,
  pendingApprovalsFor,
} from "@/domains/attendance/repository";
import { addDays } from "@/domains/attendance/calendar";
import {
  assessmentWorkspace,
  condonationQueue,
  eligibility,
  examEvents,
  studentExams,
} from "@/domains/exams/repository";
import { eligibilityFor } from "@/domains/exams/rules";
import { contactableStudents, sentLog, unreadGuardianMessages } from "@/domains/messages/repository";
import { studentsHref } from "@/domains/students/params";
import { summarize, type Visible } from "@/domains/students/query";
import { visibleStudentsIn } from "@/domains/students/repository";
import type { WorkspaceKind } from "@/lib/authz/catalogue";
import type { Authed } from "@/lib/authz/context";
import { holdsAnywhere } from "@/lib/authz/engine";
import type { OrgNode } from "@/lib/authz/types";
import { institutionNow } from "@/lib/clock";
import { ATTENDANCE_THRESHOLD } from "@/lib/demo/base";
import { formatDate, pluralize, sectionLabel } from "@/lib/utils";
import { campusPulse, rankAttention, trendSummary, type AttentionItem, type Pulse } from "./attention";

/*
 * What each dashboard puts first. Everything here is read through the same repositories as the pages it links to, so
 * counts and lists never exceed the viewer's scope or field access.
 */

/* ---------- Weekly attendance trend ---------- */

export interface TrendPoint {
  week: string;
  value: number;
  present: number;
  total: number;
}

/**
 * Present marks ÷ marks recorded, per section and week. Aggregating every mark is expensive (ADR-019), so the tenant's
 * table — a few hundred rows — is cached for ten minutes and each viewer's scope is summed from it in memory.
 */
const sectionWeeks = (tenantId: string, since: string) =>
  unstable_cache(
    async () => {
      const [rows] = await withTenant(getDb(), tenantId, (q) => [
        q
          .select({
            sectionId: s.courseOffering.sectionId,
            week: sql<string>`to_char(date_trunc('week', ${s.classSession.date}), 'YYYY-MM-DD')`,
            present: sql<number>`(count(*) filter (where ${s.attendanceRecord.status} = 'present'))::int`,
            total: sql<number>`count(*)::int`,
          })
          .from(s.attendanceRecord)
          .innerJoin(s.classSession, eq(s.classSession.id, s.attendanceRecord.sessionId))
          .innerJoin(s.courseOffering, eq(s.courseOffering.id, s.classSession.offeringId))
          .where(and(eq(s.classSession.status, "held"), gte(s.classSession.date, since)))
          .groupBy(s.courseOffering.sectionId, sql`2`),
      ]);
      return rows;
    },
    ["attendance-section-weeks", tenantId, since],
    { revalidate: 600 },
  )();

export async function weeklyAttendance(
  authed: Authed,
  sectionIds: readonly string[],
  weeks = 10,
): Promise<TrendPoint[]> {
  const since = addDays(institutionNow().toISOString().slice(0, 10), -7 * (weeks + 1));
  const ids = new Set(sectionIds);
  const byWeek = new Map<string, { present: number; total: number }>();
  for (const r of await sectionWeeks(authed.ctx.tenantId, since)) {
    if (!ids.has(r.sectionId)) continue;
    const w = byWeek.get(r.week) ?? { present: 0, total: 0 };
    w.present += r.present;
    w.total += r.total;
    byWeek.set(r.week, w);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-weeks)
    .map(([week, w]) => ({
      week,
      present: w.present,
      total: w.total,
      value: w.total ? (w.present / w.total) * 100 : 0,
    }));
}

/** Section org-unit ids of the students in a list (the trend's scope). */
export function sectionIdsOf(authed: Authed, rows: readonly Visible[]): string[] {
  return [
    ...new Set(
      rows.map((r) => authed.tree.byCode.get(r.student.sectionId)?.id).filter((x): x is string => !!x),
    ),
  ];
}

/* ---------- Scope summary and pulse ---------- */

const threshold = cache(
  async (authed: Authed) => (await attendanceContext(authed))?.thresholdPct ?? ATTENDANCE_THRESHOLD,
);

export interface ScopeSnapshot {
  unit: OrgNode;
  rows: Visible[];
  readable: Visible[];
  threshold: number;
  shortage: Visible[];
  notEligible: Visible[];
  highRisk: Visible[];
  trend: TrendPoint[];
}

export const scopeSnapshot = cache(async (authed: Authed, unit: OrgNode): Promise<ScopeSnapshot> => {
  const rows = await visibleStudentsIn(authed, unit);
  const readable = rows.filter((r) => r.access.academic && r.student.status === "active");
  const shortage = readable
    .filter((r) => r.student.attendancePct < r.student.attendanceThreshold)
    .sort((a, b) => a.student.attendancePct - b.student.attendancePct);
  return {
    unit,
    rows,
    readable,
    threshold: await threshold(authed),
    shortage,
    notEligible: shortage.filter(
      (r) => eligibilityFor(r.student.attendancePct, r.student.attendanceThreshold) === "not_eligible",
    ),
    highRisk: rows.filter((r) => r.access.risk && r.student.risk.level === "high"),
    trend: await weeklyAttendance(authed, sectionIdsOf(authed, readable)),
  };
});

export async function pulseFor(authed: Authed, unit: OrgNode): Promise<Pulse> {
  const [snap, approvals, notices] = await Promise.all([
    scopeSnapshot(authed, unit),
    pendingApprovalsFor(authed),
    pendingForApproval(authed),
  ]);
  const sum = summarize(snap.readable);
  return campusPulse({
    scopeName:
      unit.type === "institution"
        ? "The campus"
        : unit.type === "section"
          ? sectionLabel(unit.code)
          : unit.name,
    students: snap.readable.length,
    avgAttendance: sum.avgAttendance,
    threshold: snap.threshold,
    shortage: snap.shortage.length,
    notEligible: snap.notEligible.length,
    highRisk: snap.highRisk.length,
    approvalsPending: (approvals?.length ?? 0) + notices.length,
    approvalsOverdue: approvals?.filter((a) => a.overdue).length ?? 0,
    attendanceDelta: trendSummary(snap.trend).delta,
  });
}

/* ---------- Attention ---------- */

async function common(authed: Authed): Promise<AttentionItem[]> {
  const [today, approvals, notices, marks] = await Promise.all([
    listInbox(authed, "important"),
    pendingApprovalsFor(authed),
    pendingForApproval(authed),
    holdsAnywhere(authed.ctx, "marks:moderate") ? assessmentWorkspace(authed) : Promise.resolve(null),
  ]);
  const items: AttentionItem[] = [];
  const critical = today.filter((a) => a.severity === "critical" && a.addressed && !a.read);
  for (const a of critical)
    items.push({
      id: `notice-${a.id}`,
      priority: "critical",
      title: a.title,
      detail: `Critical notice from ${a.author}, ${a.authorRole}`,
      href: `/announcements?view=important&id=${a.id}`,
      cta: a.requiresAck ? "Read and acknowledge" : "Read",
    });
  const ack = today.filter((a) => a.requiresAck && !a.acknowledged && a.addressed && !critical.includes(a));
  if (ack.length)
    items.push({
      id: "notices-ack",
      priority: "action",
      title: `${pluralize(ack.length, "notice")} to acknowledge`,
      detail: ack
        .map((a) => a.title)
        .slice(0, 2)
        .join(" · "),
      href: "/announcements?view=important",
      cta: "Acknowledge",
      count: ack.length,
    });
  const overdue = approvals?.filter((a) => a.overdue) ?? [];
  if (overdue.length)
    items.push({
      id: "approvals-overdue",
      priority: "critical",
      title: `${pluralize(overdue.length, "approval")} past the SLA`,
      detail: overdue
        .map((a) => a.title)
        .slice(0, 2)
        .join(" · "),
      href: "/approvals",
      cta: "Decide now",
      count: overdue.length,
    });
  const waiting = (approvals?.length ?? 0) - overdue.length + notices.length;
  if (waiting > 0)
    items.push({
      id: "approvals",
      priority: "action",
      title: `${pluralize(waiting, "decision")} waiting for you`,
      detail: [
        notices.length ? pluralize(notices.length, "announcement") : null,
        approvals?.length ? `${approvals.length - overdue.length} attendance and leave` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: "/approvals",
      cta: "Review",
      count: waiting,
    });
  if (marks?.toModerate.length)
    items.push({
      id: "marks-moderate",
      priority: "action",
      title: `${pluralize(marks.toModerate.length, "internal mark sheet")} to moderate`,
      detail: marks.toModerate
        .slice(0, 3)
        .map((m) => `${m.offering.courseCode} ${m.offering.sectionLabel}`)
        .join(" · "),
      href: "/marks",
      cta: "Moderate",
      count: marks.toModerate.length,
    });
  return items;
}

async function cohort(authed: Authed, unit: OrgNode): Promise<AttentionItem[]> {
  const snap = await scopeSnapshot(authed, unit);
  const items: AttentionItem[] = [];
  const base =
    unit.type === "department"
      ? { department: unit.code }
      : unit.type === "section"
        ? { sectionId: unit.code }
        : {};
  if (snap.notEligible.length)
    items.push({
      id: "not-eligible",
      priority: "critical",
      title: `${pluralize(snap.notEligible.length, "student")} not eligible for the semester-end exams`,
      detail: `Below the condonation band (more than 10 points under their requirement): ${snap.notEligible
        .slice(0, 3)
        .map((r) => `${r.student.name} ${r.student.attendancePct.toFixed(0)}%`)
        .join(", ")}`,
      href: studentsHref({ ...base, shortage: true, sort: "attendance" }),
      cta: "See students",
      count: snap.notEligible.length,
    });
  const condonable = snap.shortage.length - snap.notEligible.length;
  if (condonable > 0)
    items.push({
      id: "condonable",
      priority: "important",
      title: `${pluralize(condonable, "student")} need condonation to sit the exams`,
      detail: `Within 10 points below the ${snap.threshold}% requirement`,
      href: studentsHref({ ...base, shortage: true, sort: "attendance" }),
      cta: "See students",
      count: condonable,
    });
  if (snap.highRisk.length)
    items.push({
      id: "high-risk",
      priority: "important",
      title: `${pluralize(snap.highRisk.length, "student")} at high risk`,
      detail: "Two or more risk factors (attendance, CGPA, backlogs), or attendance under 65%",
      href: studentsHref({ ...base, risk: "high", sort: "attendance" }),
      cta: "Review",
      count: snap.highRisk.length,
    });
  const contactable = await contactableStudents(authed);
  const toInform = (contactable ?? []).filter(
    (c) => c.followUp && snap.rows.some((r) => r.student.id === c.id),
  );
  if (toInform.length)
    items.push({
      id: "guardians",
      priority: "action",
      title: `${pluralize(toInform.length, "guardian")} to inform about attendance`,
      detail: "Below the requirement and not told in the last 14 days",
      href: "/parent-communication",
      cta: "Message guardians",
      count: toInform.length,
    });
  return items;
}

async function teaching(authed: Authed): Promise<AttentionItem[]> {
  const [open, marks] = await Promise.all([myOpenSessions(authed), assessmentWorkspace(authed)]);
  const items: AttentionItem[] = [];
  if (open?.overdue.length)
    items.push({
      id: "classes-overdue",
      priority: "critical",
      title: `${pluralize(open.overdue.length, "earlier class", "earlier classes")} never marked`,
      detail: "After the day, attendance goes to your HOD as a late submission",
      href: "/tasks",
      cta: "Submit late",
      count: open.overdue.length,
    });
  if (open?.markNow.length)
    items.push({
      id: "classes-now",
      priority: "action",
      title: `${pluralize(open.markNow.length, "class", "classes")} to mark today`,
      detail: open.markNow.map((c) => `${c.startsAt} ${c.courseCode} ${c.sectionLabel}`).join(" · "),
      href: "/attendance",
      cta: "Mark attendance",
      count: open.markNow.length,
    });
  const components = marks?.mine.flatMap((m) => m.components.map((c) => ({ c, o: m.offering }))) ?? [];
  const returned = components.filter((x) => x.c.status === "open" && x.c.returnNote);
  if (returned.length)
    items.push({
      id: "marks-returned",
      priority: "action",
      title: `${pluralize(returned.length, "mark sheet")} returned by the HOD`,
      detail: returned
        .map((x) => `${x.c.label} ${x.o.courseCode} ${x.o.sectionLabel}: “${x.c.returnNote}”`)
        .slice(0, 2)
        .join(" · "),
      href: `/marks/${returned[0]!.o.id}`,
      cta: "Fix and resubmit",
      count: returned.length,
    });
  return items;
}

async function self(authed: Authed, v: Visible): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const st = v.student;
  if (v.access.academic && st.attendancePct < st.attendanceThreshold) {
    const e = eligibilityFor(st.attendancePct, st.attendanceThreshold);
    items.push({
      id: "my-attendance",
      priority: e === "not_eligible" ? "critical" : "action",
      title: `Attendance ${st.attendancePct.toFixed(1)}% — below the ${st.attendanceThreshold}% requirement`,
      detail:
        e === "not_eligible"
          ? "Below the condonation band: you cannot sit the semester-end exams as things stand"
          : "Within the condonation band: attend every class and talk to your class incharge",
      href: "/my/attendance",
      cta: "See subjects",
    });
  }
  const exams = v.access.academic ? await studentExams(authed, v) : null;
  const now = institutionNow().toISOString().slice(0, 10);
  const next = exams?.sittings
    .flatMap((s) => s.papers)
    .filter((p) => p.slot && p.slot.date >= now)
    .sort((a, b) => a.slot!.date.localeCompare(b.slot!.date))[0];
  if (next)
    items.push({
      id: "next-exam",
      priority: "important",
      title: `Next exam: ${next.courseCode} on ${formatDate(next.slot!.date)}`,
      detail: next.courseName,
      href: "/my/exams",
      cta: "Exam timetable",
    });
  const unread = await unreadGuardianMessages(authed);
  if (unread)
    items.push({
      id: "messages",
      priority: "action",
      title: `${pluralize(unread, "message")} from the college`,
      detail: "Personal messages about your child",
      href: "/my/messages",
      cta: "Read",
      count: unread,
    });
  return items;
}

async function examinations(authed: Authed): Promise<AttentionItem[]> {
  const [events, condonations, rows] = await Promise.all([
    examEvents(authed),
    condonationQueue(authed),
    eligibility(authed),
  ]);
  const items: AttentionItem[] = [];
  const toEnter = (events ?? []).filter(
    (e) => e.status === "scheduled" && e.startsOn <= institutionNow().toISOString().slice(0, 10),
  );
  for (const e of toEnter)
    if (e.registrations > e.entered)
      items.push({
        id: `enter-${e.id}`,
        priority: "action",
        title: `${e.registrations - e.entered} semester-end marks to enter`,
        detail: e.name,
        href: `/exams/${e.id}`,
        cta: "Enter marks",
        count: e.registrations - e.entered,
      });
  const pending = (condonations ?? []).filter((c) => c.status === "pending");
  if (pending.length)
    items.push({
      id: "condonations",
      priority: "action",
      title: `${pluralize(pending.length, "condonation request")} to decide`,
      detail: "Students within 10 points of their attendance requirement",
      href: "/exams",
      cta: "Decide",
      count: pending.length,
    });
  const blocked = (rows ?? []).filter((r) => !r.maySit).length;
  if (blocked)
    items.push({
      id: "eligibility",
      priority: "important",
      title: `${pluralize(blocked, "student")} not yet eligible for the November exams`,
      detail: "Below the requirement without an approved condonation",
      href: "/exams",
      cta: "Review",
      count: blocked,
    });
  return items;
}

export async function attentionFor(
  authed: Authed,
  workspace: WorkspaceKind,
  unit: OrgNode,
  record?: Visible,
): Promise<AttentionItem[]> {
  const parts = await Promise.all([
    common(authed),
    workspace === "leadership" || workspace === "department" || workspace === "class"
      ? cohort(authed, unit)
      : Promise.resolve([]),
    workspace === "teaching" || workspace === "class" ? teaching(authed) : Promise.resolve([]),
    (workspace === "self" || workspace === "guardian") && record ? self(authed, record) : Promise.resolve([]),
    workspace === "examinations" ? examinations(authed) : Promise.resolve([]),
  ]);
  return rankAttention(parts.flat());
}

/* ---------- Recent activity ---------- */

export interface ActivityItem {
  id: string;
  at: string;
  title: string;
  detail: string;
  href: string;
  kind: "notice" | "message" | "decision";
}

/** What happened lately in the viewer's scope: notices, guardian messages and decided requests (business time). */
export async function recentActivity(authed: Authed, limit = 6): Promise<ActivityItem[]> {
  const [notices, messages, queue] = await Promise.all([
    listInbox(authed, "all"),
    holdsAnywhere(authed.ctx, "guardian:message") ? sentLog(authed, 10) : Promise.resolve([]),
    authed.ctx.assignments.some((a) => a.scopeMode !== "linked")
      ? approvalQueue(authed)
      : Promise.resolve(null),
  ]);
  const now = institutionNow().toISOString();
  const items: ActivityItem[] = [
    ...notices.map((a) => ({
      id: `n-${a.id}`,
      at: a.publishedAt,
      title: a.title,
      detail: `Notice · ${a.author}`,
      href: `/announcements?view=all&id=${a.id}`,
      kind: "notice" as const,
    })),
    ...messages.map((m) => ({
      id: `m-${m.id}`,
      at: m.acknowledgedAt ?? m.sentAt,
      title: m.reply ? `Reply from the guardian of ${m.studentName}` : m.subject,
      detail: m.acknowledgedAt ? "Guardian acknowledged" : `Message to guardians · ${m.senderName}`,
      href: "/parent-communication#sent",
      kind: "message" as const,
    })),
    ...(queue?.decided ?? []).map((d) => ({
      id: `d-${d.id}`,
      at: d.decidedAt ?? d.requestedAt,
      title: `${d.status === "approved" ? "Approved" : d.status === "rejected" ? "Rejected" : "Withdrawn"}: ${d.title}`,
      detail: `${d.requester}${d.decidedBy ? ` · decided by ${d.decidedBy}` : ""}`,
      href: "/approvals",
      kind: "decision" as const,
    })),
  ];
  return items
    .filter((i) => i.at <= now)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** Today's timetable for a section or the viewer's teaching (re-exported for dashboards). */
export { classesOn };
