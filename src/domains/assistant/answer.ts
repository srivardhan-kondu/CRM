import "server-only";

import { cache } from "react";
import { getDb } from "@/db/client";
import { listInbox, pendingForApproval } from "@/domains/announcements/repository";
import { classesOn, myOpenSessions, pendingApprovalsFor } from "@/domains/attendance/repository";
import { assessmentWorkspace, condonationQueue, studentExams } from "@/domains/exams/repository";
import { loadEvents } from "@/domains/exams/load";
import { eligibilityFor } from "@/domains/exams/rules";
import { studentsHref } from "@/domains/students/params";
import { groupBy, type Visible } from "@/domains/students/query";
import { linkedStudents, visibleStudents } from "@/domains/students/repository";
import type { Authed } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import { formatDate, pluralize, sectionLabel } from "@/lib/utils";
import { parseIntent, SUGGESTED_QUESTIONS, type Intent } from "./intents";

/*
 * Ask CampusOS. Every answer is computed from the same repositories the pages use, so it is limited to the viewer's
 * scope and field access exactly as the linked pages are. Rule-based (ADR-025): the "answer" is written from the
 * numbers, never generated, and always comes with the records and links it is based on.
 */

export interface AnswerRecord {
  label: string;
  sublabel?: string;
  value?: string;
  tone?: "critical" | "warning" | "neutral";
  href: string;
}

export interface AssistantAnswer {
  question: string;
  understood: boolean;
  answer: string;
  records: AnswerRecord[];
  total: number;
  recommendation: { text: string; href?: string } | null;
  sources: { label: string; href: string }[];
  /** Plain statement of what the answer covers, so a narrow scope is never mistaken for the whole institution. */
  scope: string;
  suggestions: readonly string[];
}

const MAX_RECORDS = 8;

const scopeOf = (authed: Authed) =>
  authed.ctx.active ? `${authed.ctx.active.roleName} access` : "your access";

function studentRecord(v: Visible, value: string, tone: AnswerRecord["tone"]): AnswerRecord {
  return {
    label: v.student.name,
    sublabel: `${v.student.studentNumber} · ${v.student.sectionLabel}`,
    value,
    tone,
    href: `/students/${v.student.id}`,
  };
}

const academicRows = cache(async (authed: Authed) =>
  (await visibleStudents(authed)).filter((v) => v.access.academic),
);

async function attendanceBelow(
  authed: Authed,
  threshold: number | null,
): Promise<Omit<AssistantAnswer, "question" | "understood" | "suggestions">> {
  const rows = await academicRows(authed);
  const below = rows
    .filter((v) => v.student.attendancePct < (threshold ?? v.student.attendanceThreshold))
    .sort((a, b) => a.student.attendancePct - b.student.attendancePct);
  const label = threshold ? `below ${threshold}%` : "below their programme's requirement";
  const notEligible = below.filter(
    (v) => eligibilityFor(v.student.attendancePct, v.student.attendanceThreshold) === "not_eligible",
  ).length;
  return {
    answer:
      rows.length === 0
        ? "You don't have access to attendance figures for any student."
        : below.length === 0
          ? `No student in your scope is ${label}.`
          : `${pluralize(below.length, "student")} of ${rows.length} in your scope ${below.length === 1 ? "is" : "are"} ${label}${notEligible ? `; ${notEligible} ${notEligible === 1 ? "is" : "are"} below the condonation band and not eligible for the semester-end exams as things stand` : ""}.`,
    records: below
      .slice(0, MAX_RECORDS)
      .map((v) =>
        studentRecord(
          v,
          `${v.student.attendancePct.toFixed(1)}%`,
          v.student.attendancePct < v.student.attendanceThreshold - 10 ? "critical" : "warning",
        ),
      ),
    total: below.length,
    recommendation: below.length
      ? {
          text: "Inform their guardians and plan condonation requests before the November examinations.",
          href: "/parent-communication",
        }
      : null,
    sources: [
      { label: "Students below threshold", href: studentsHref({ shortage: true, sort: "attendance" }) },
    ],
    scope: scopeOf(authed),
  };
}

async function sectionsBelow(authed: Authed) {
  const rows = await academicRows(authed);
  const sections = [...groupBy(rows, (v) => v.student.sectionId)]
    .map(([code, list]) => {
      const avg = list.reduce((n, v) => n + v.student.attendancePct, 0) / list.length;
      const threshold = list[0]!.student.attendanceThreshold;
      const short = list.filter((v) => v.student.attendancePct < v.student.attendanceThreshold).length;
      return { code, avg, threshold, short, size: list.length };
    })
    .filter((s) => s.avg < s.threshold || s.short > 0)
    .sort((a, b) => a.avg - b.avg || b.short - a.short);
  const belowAvg = sections.filter((s) => s.avg < s.threshold);
  return {
    answer:
      rows.length === 0
        ? "You don't have access to attendance figures for any section."
        : belowAvg.length
          ? `${pluralize(belowAvg.length, "section")} ${belowAvg.length === 1 ? "averages" : "average"} below the attendance requirement. ${sections.length - belowAvg.length} more ${sections.length - belowAvg.length === 1 ? "has" : "have"} individual students below it.`
          : sections.length
            ? `Every section averages above the requirement, but ${pluralize(sections.length, "section")} ${sections.length === 1 ? "has" : "have"} students below it.`
            : "Every section and every student is above the attendance requirement.",
    records: sections.slice(0, MAX_RECORDS).map((s) => ({
      label: sectionLabel(s.code),
      sublabel: `${pluralize(s.short, "student")} below ${s.threshold}% · ${s.size} in section`,
      value: `${s.avg.toFixed(1)}%`,
      tone: (s.avg < s.threshold ? "critical" : "warning") as AnswerRecord["tone"],
      href: `/attendance/sections/${s.code}`,
    })),
    total: sections.length,
    recommendation: sections.length
      ? { text: "Open the section register to see which subjects drive the shortage.", href: "/attendance" }
      : null,
    sources: [{ label: "Attendance overview", href: "/attendance" }],
    scope: scopeOf(authed),
  };
}

async function backlogs(authed: Authed, min: number) {
  const rows = (await academicRows(authed))
    .filter((v) => v.student.backlogs >= min)
    .sort((a, b) => b.student.backlogs - a.student.backlogs);
  return {
    answer: rows.length
      ? `${pluralize(rows.length, "student")} in your scope ${rows.length === 1 ? "has" : "have"} ${min > 1 ? `${min} or more` : "at least one"} active backlog${min > 1 ? "s" : ""}.`
      : `No student in your scope has ${min > 1 ? "multiple backlogs" : "an active backlog"}.`,
    records: rows
      .slice(0, MAX_RECORDS)
      .map((v) =>
        studentRecord(
          v,
          `${v.student.backlogs} backlog${v.student.backlogs > 1 ? "s" : ""}`,
          v.student.backlogs >= 3 ? "critical" : "warning",
        ),
      ),
    total: rows.length,
    recommendation: rows.length
      ? { text: "Check their supplementary registrations and assign a mentor follow-up." }
      : null,
    sources: [{ label: "Students by CGPA", href: studentsHref({ sort: "cgpa" }) }],
    scope: scopeOf(authed),
  };
}

async function intervention(authed: Authed) {
  const rows = (await visibleStudents(authed))
    .filter((v) => v.access.risk && v.student.risk.level !== "none")
    .sort((a, b) =>
      a.student.risk.level === b.student.risk.level
        ? a.student.attendancePct - b.student.attendancePct
        : a.student.risk.level === "high"
          ? -1
          : 1,
    );
  const high = rows.filter((v) => v.student.risk.level === "high").length;
  return {
    answer: rows.length
      ? `${pluralize(high, "student")} ${high === 1 ? "is" : "are"} high risk${rows.length > high ? ` and ${rows.length - high} more on watch` : ""}. Risk is flagged from attendance, CGPA and backlogs against stated thresholds.`
      : authed.ctx.assignments.some((a) => a.permissions.has("student.risk:read"))
        ? "No student in your scope crosses a risk threshold."
        : "Your role doesn't include student risk information.",
    records: rows
      .slice(0, MAX_RECORDS)
      .map((v) =>
        studentRecord(
          v,
          v.student.risk.factors.map((f) => f.label).join(", "),
          v.student.risk.level === "high" ? "critical" : "warning",
        ),
      ),
    total: rows.length,
    recommendation: high
      ? {
          text: "Start with the high-risk students: meet them and inform their guardians.",
          href: "/parent-communication",
        }
      : null,
    sources: [{ label: "High-risk students", href: studentsHref({ risk: "high", sort: "attendance" }) }],
    scope: scopeOf(authed),
  };
}

async function approvals(authed: Authed) {
  const [attendance, notices, workspace, condonations] = await Promise.all([
    pendingApprovalsFor(authed),
    pendingForApproval(authed),
    assessmentWorkspace(authed),
    condonationQueue(authed),
  ]);
  const records: AnswerRecord[] = [
    ...notices.map((a) => ({
      label: a.title,
      sublabel: `Announcement · ${a.author}`,
      value: "Notice",
      tone: "neutral" as const,
      href: "/approvals",
    })),
    ...(attendance ?? []).map((a) => ({
      label: a.title,
      sublabel: a.requester,
      value: a.overdue ? "SLA breached" : `Due ${formatDate(a.dueAt)}`,
      tone: (a.overdue ? "critical" : "neutral") as AnswerRecord["tone"],
      href: `/approvals#${a.id}`,
    })),
    ...(workspace?.toModerate ?? []).map((m) => ({
      label: `${m.component.label} — ${m.offering.courseCode} · ${m.offering.sectionLabel}`,
      sublabel: "Internal marks to moderate",
      value: "Marks",
      tone: "neutral" as const,
      href: `/marks/${m.offering.id}`,
    })),
    ...(condonations ?? [])
      .filter((c) => c.status === "pending")
      .map((c) => ({
        label: c.studentName,
        sublabel: "Condonation request",
        value: "Exams",
        tone: "neutral" as const,
        href: "/exams",
      })),
  ];
  const overdue = (attendance ?? []).filter((a) => a.overdue).length;
  return {
    answer: records.length
      ? `${pluralize(records.length, "item")} ${records.length === 1 ? "waits" : "wait"} for your decision${overdue ? `, ${overdue} past the SLA` : ""}.`
      : "Nothing is waiting for your decision.",
    records: records.slice(0, MAX_RECORDS),
    total: records.length,
    recommendation: overdue
      ? { text: "Clear the items past their SLA first.", href: "/approvals" }
      : records.length
        ? { text: "Open the approvals queue.", href: "/approvals" }
        : null,
    sources: [{ label: "Approvals", href: "/approvals" }],
    scope: scopeOf(authed),
  };
}

async function exams(authed: Authed, external: boolean) {
  const now = institutionNow().toISOString().slice(0, 10);
  const self = [...(await linkedStudents(authed, "self")), ...(await linkedStudents(authed, "guardian"))][0];
  if (self) {
    const mine = await studentExams(authed, self);
    const papers = (mine?.sittings ?? [])
      .flatMap((s) => s.papers.map((p) => ({ ...p, event: s.event })))
      .filter((p) => p.slot && p.slot.date >= now);
    return {
      answer: papers.length
        ? `${self.student.name.split(" ")[0]} has ${pluralize(papers.length, "paper")} coming up, starting ${formatDate(papers[0]!.slot!.date)}.${mine && !mine.maySit ? " Attendance is below the requirement, so eligibility needs attention first." : ""}`
        : "No upcoming papers are scheduled for you yet.",
      records: papers.slice(0, MAX_RECORDS).map((p) => ({
        label: `${p.courseCode} ${p.courseName}`,
        sublabel: p.event.name,
        value: `${formatDate(p.slot!.date)} · ${p.slot!.session}`,
        tone: "neutral" as const,
        href: "/my/exams",
      })),
      total: papers.length,
      recommendation:
        mine && !mine.maySit
          ? { text: "Talk to your class incharge about condonation.", href: "/my/exams" }
          : null,
      sources: [{ label: "My exams", href: "/my/exams" }],
      scope: "Your own record",
    };
  }
  const events = (await loadEvents(getDb(), authed.ctx.tenantId)).filter(
    (e) => e.endsOn >= now && (!external || e.kind === "regular"),
  );
  const notices = (await listInbox(authed, "exams")).slice(0, 3);
  return {
    answer: events.length
      ? `${pluralize(events.length, "examination")} ${events.length === 1 ? "is" : "are"} scheduled or in progress: ${events.map((e) => `${e.name} (${formatDate(e.startsOn)})`).join("; ")}.`
      : "No examinations are scheduled.",
    records: [
      ...events.map((e) => ({
        label: e.name,
        sublabel: e.status === "published" ? "Results published" : "Scheduled",
        value: `${formatDate(e.startsOn)} – ${formatDate(e.endsOn)}`,
        tone: "neutral" as const,
        href: authed.ctx.assignments.some((a) => a.permissions.has("exam:manage"))
          ? `/exams/${e.id}`
          : "/announcements?view=exams",
      })),
      ...notices.map((n) => ({
        label: n.title,
        sublabel: `Notice · ${n.authorRole}`,
        value: n.deadline ? `Due ${formatDate(n.deadline)}` : undefined,
        tone: "neutral" as const,
        href: `/announcements?view=exams&id=${n.id}`,
      })),
    ].slice(0, MAX_RECORDS),
    total: events.length + notices.length,
    recommendation: null,
    sources: [{ label: "Exam notices", href: "/announcements?view=exams" }],
    scope: scopeOf(authed),
  };
}

async function announcementsToday(authed: Authed) {
  const items = await listInbox(authed, "important");
  const critical = items.filter((a) => a.severity === "critical");
  const ack = items.filter((a) => a.requiresAck && !a.acknowledged);
  return {
    answer: items.length
      ? `${pluralize(items.length, "notice")} need${items.length === 1 ? "s" : ""} your attention today${critical.length ? `, ${critical.length} critical: “${critical[0]!.title}”` : ""}.${ack.length ? ` ${pluralize(ack.length, "notice")} ${ack.length === 1 ? "asks" : "ask"} for your acknowledgement.` : ""}`
      : "Nothing new needs your attention in the inbox today.",
    records: items.slice(0, MAX_RECORDS).map((a) => ({
      label: a.title,
      sublabel: `${a.authorRole} · ${a.summary}`,
      value:
        a.requiresAck && !a.acknowledged ? "Acknowledge" : a.severity === "critical" ? "Critical" : undefined,
      tone: (a.severity === "critical"
        ? "critical"
        : a.requiresAck && !a.acknowledged
          ? "warning"
          : "neutral") as AnswerRecord["tone"],
      href: `/announcements?view=important&id=${a.id}`,
    })),
    total: items.length,
    recommendation: ack.length
      ? { text: "Acknowledge the notices that ask for it.", href: "/announcements?view=important" }
      : null,
    sources: [{ label: "Inbox", href: "/announcements" }],
    scope: "Notices addressed to you or within your scope",
  };
}

async function classesToday(authed: Authed) {
  const self = (await linkedStudents(authed, "self"))[0];
  const today = self
    ? await classesOn(authed, { sectionCode: self.student.sectionId })
    : await classesOn(authed, { mine: true });
  const classes = today?.classes ?? [];
  const toMark = classes.filter((c) => c.window === "open" && c.canMark && !c.recorded);
  return {
    answer: today?.holiday
      ? `Today is a holiday (${today.holiday}).`
      : classes.length
        ? `${pluralize(classes.length, "class")} today${toMark.length ? `; ${toMark.length} ${toMark.length === 1 ? "is" : "are"} ready to mark now` : ""}.`
        : "No classes are scheduled for you today.",
    records: classes.map((c) => ({
      label: `${c.startsAt}–${c.endsAt} · ${c.courseName}`,
      sublabel: `${c.courseCode} · ${c.sectionLabel} · ${c.room}`,
      value: c.recorded ? "Marked" : c.window === "open" && c.canMark ? "Mark now" : undefined,
      tone: (c.window === "open" && c.canMark && !c.recorded ? "warning" : "neutral") as AnswerRecord["tone"],
      href: self ? "/my/attendance" : "/attendance",
    })),
    total: classes.length,
    recommendation: toMark.length
      ? { text: "Mark attendance for the classes that have started.", href: "/attendance" }
      : null,
    sources: [
      { label: self ? "My attendance" : "Attendance", href: self ? "/my/attendance" : "/attendance" },
    ],
    scope: self ? "Your timetable" : "Classes you teach",
  };
}

async function unmarked(authed: Authed) {
  const open = await myOpenSessions(authed);
  const list = [...(open?.markNow ?? []), ...(open?.overdue ?? [])];
  return {
    answer:
      open === null
        ? "You don't teach any classes this term."
        : list.length
          ? `${pluralize(list.length, "class")} still ${list.length === 1 ? "needs" : "need"} attendance: ${open.markNow.length} today, ${open.overdue.length} from earlier days (those need a late submission).`
          : "Every class you taught has been marked.",
    records: list.slice(0, MAX_RECORDS).map((c) => ({
      label: `${c.courseCode} · ${c.sectionLabel}`,
      sublabel: `${formatDate(c.date)} ${c.startsAt}`,
      value: c.window === "open" ? "Mark now" : "Late",
      tone: (c.window === "open" ? "warning" : "critical") as AnswerRecord["tone"],
      href: "/tasks",
    })),
    total: list.length,
    recommendation: list.length
      ? {
          text: "Mark today's classes before midnight; earlier ones go to your HOD as late submissions.",
          href: "/tasks",
        }
      : null,
    sources: [{ label: "Tasks", href: "/tasks" }],
    scope: "Classes you teach",
  };
}

async function resolve(authed: Authed, intent: Intent) {
  switch (intent.kind) {
    case "attendance_below":
      return attendanceBelow(authed, intent.threshold);
    case "sections_below":
      return sectionsBelow(authed);
    case "backlogs":
      return backlogs(authed, intent.min);
    case "intervention":
      return intervention(authed);
    case "pending_approvals":
      return approvals(authed);
    case "exams_upcoming":
      return exams(authed, intent.external);
    case "announcements_today":
      return announcementsToday(authed);
    case "classes_today":
      return classesToday(authed);
    case "unmarked_classes":
      return unmarked(authed);
  }
}

export async function ask(authed: Authed, question: string): Promise<AssistantAnswer> {
  const intent = parseIntent(question);
  if (!intent)
    return {
      question,
      understood: false,
      answer:
        "I answer questions about students, attendance, results, approvals, exams, classes and notices in your scope. Try one of these:",
      records: [],
      total: 0,
      recommendation: null,
      sources: [],
      scope: scopeOf(authed),
      suggestions: SUGGESTED_QUESTIONS,
    };
  return { question, understood: true, suggestions: [], ...(await resolve(authed, intent)) };
}
