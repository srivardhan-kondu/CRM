import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  Check,
  Clock,
  Inbox,
  MapPin,
  PartyPopper,
  Paperclip,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { attendanceTone, RiskBadge, SeverityBadge } from "@/components/patterns/status";
import { EmptyState } from "@/components/patterns/states";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";
import type { Announcement } from "@/domains/announcements/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markHref } from "@/domains/attendance/links";
import type { ClassOccurrence, PendingApproval } from "@/domains/attendance/repository";
import type { Student } from "@/domains/students/types";
import { ATTENDANCE_THRESHOLD, DEMO_NOW } from "@/lib/demo/fixtures";
import { cn, formatRelative } from "@/lib/utils";

export interface BarRow {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  href: string;
  flag?: string;
}

/** Horizontal bars with a visible threshold line. Worst first; every row drills down. */
export function ThresholdBars({
  rows,
  threshold = ATTENDANCE_THRESHOLD,
  min = 50,
}: {
  rows: BarRow[];
  threshold?: number;
  min?: number;
}) {
  const scale = (v: number) => ((Math.max(min, Math.min(100, v)) - min) / (100 - min)) * 100;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const tone = attendanceTone(r.value, threshold);
        const fill = { success: "bg-brand/80", warning: "bg-warning", danger: "bg-danger" }[tone];
        return (
          <li key={r.key}>
            <Link
              href={r.href}
              className="group grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_4rem]"
            >
              <span className="min-w-0">
                <span className="text-foreground group-hover:text-brand block truncate text-sm">
                  {r.label}
                </span>
                {r.sublabel && <span className="text-2xs text-subtle block truncate">{r.sublabel}</span>}
              </span>
              <span className="bg-surface-sunken relative h-2 rounded-full" aria-hidden>
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full", fill)}
                  style={{ width: `${scale(r.value)}%` }}
                />
                <span
                  className="bg-foreground/40 absolute -inset-y-1 w-px"
                  style={{ left: `${scale(threshold)}%` }}
                />
              </span>
              <span className="tabular text-right text-sm font-medium">
                {r.value.toFixed(1)}%
                {r.flag && <span className="text-2xs text-danger block font-normal">{r.flag}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function WidgetCard({
  title,
  description,
  action,
  footer,
  children,
  className,
  flush,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className={cn("flex-1", flush && "p-0")}>{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  );
}

export function DrillLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-brand inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline"
    >
      {children}
      <ArrowRight aria-hidden className="size-3" />
    </Link>
  );
}

/** Students needing attention, each with the explicit reasons behind the flag. */
export function AttentionList({ students, empty }: { students: Student[]; empty: string }) {
  if (students.length === 0) {
    return <EmptyState icon={PartyPopper} title="No one flagged" description={empty} className="py-8" />;
  }
  return (
    <ul className="divide-border divide-y">
      {students.map((s) => (
        <li key={s.id}>
          <Link
            href={`/students/${s.id}`}
            className="hover:bg-surface-muted flex items-start gap-3 px-4 py-3"
          >
            <Avatar name={s.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-sm font-medium">{s.name}</span>
                <span className="text-2xs text-subtle font-mono">{s.studentNumber}</span>
                <span className="text-2xs text-subtle">{s.sectionLabel}</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {s.risk.factors.map((f) => (
                  <li key={f.key} className="text-muted flex items-center gap-1.5 text-xs">
                    <AlertTriangle aria-hidden className="text-warning size-3" />
                    <span>
                      <span className="text-foreground">{f.label}</span> — {f.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <RiskBadge level={s.risk.level} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A day's classes with their attendance state; the teacher of a running class gets a direct "Mark" action. */
export function ScheduleList({
  classes,
  now,
  showSection,
  emptyTitle = "No classes today",
  emptyDescription = "The timetable has no classes scheduled for today.",
}: {
  classes: ClassOccurrence[];
  /** Institution wall-clock time ("09:30"), for "in session". */
  now: string;
  showSection?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (classes.length === 0) {
    return (
      <EmptyState icon={CalendarCheck} title={emptyTitle} description={emptyDescription} className="py-8" />
    );
  }
  return (
    <ol className="divide-border divide-y">
      {classes.map((c) => {
        const live = c.window === "open" && now < c.endsAt;
        const done = c.window === "closed" || (c.window === "open" && !live);
        return (
          <li key={c.key} className="flex items-center gap-3 px-4 py-2.5">
            <div className="tabular w-14 shrink-0 text-xs">
              <div className={cn("font-medium", done ? "text-subtle" : "text-foreground")}>{c.startsAt}</div>
              <div className="text-subtle">{c.endsAt}</div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {c.courseName}{" "}
                <span className="text-2xs text-subtle font-mono font-normal">{c.courseCode}</span>
              </p>
              <p className="text-muted flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden className="size-3" />
                  {c.room}
                </span>
                {showSection ? (
                  <span>{c.sectionLabel}</span>
                ) : (
                  <span className="truncate">{c.teachers.join(", ") || "No teacher allocated"}</span>
                )}
              </p>
            </div>
            <ClassState c={c} live={live} />
          </li>
        );
      })}
    </ol>
  );
}

function ClassState({ c, live }: { c: ClassOccurrence; live: boolean }) {
  if (c.recorded?.status === "held") {
    const total = c.recorded.present + c.recorded.absent;
    const chip = (
      <Badge tone="success">
        <Check aria-hidden /> Marked · {c.recorded.present}/{total}
      </Badge>
    );
    return c.canMark ? <Link href={markHref(c)}>{chip}</Link> : chip;
  }
  if (c.recorded?.status === "cancelled") return <Badge tone="neutral">Not held</Badge>;
  if (c.window === "open" && c.canMark)
    return (
      <Button asChild size="sm">
        <Link href={markHref(c)}>Mark attendance</Link>
      </Button>
    );
  if (live)
    return (
      <span className="bg-success-soft text-2xs text-success-soft-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium">
        <span className="bg-success size-1.5 animate-pulse rounded-full" /> In session
      </span>
    );
  if (c.window === "open" || c.window === "closed") {
    if (c.pendingRequestId) return <Badge tone="info">Awaiting approval</Badge>;
    return <Badge tone="warning">Not marked</Badge>;
  }
  return null;
}

export function NoticeList({ items }: { items: Announcement[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No active notices"
        description="Notices addressed to you will appear here."
        className="py-8"
      />
    );
  }
  return (
    <ul className="divide-border divide-y">
      {items.map((a) => (
        <li key={a.id}>
          <Link
            href={`/announcements?view=mine&id=${a.id}`}
            className="hover:bg-surface-muted block px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <SeverityBadge severity={a.severity} />
              <span className="text-2xs text-subtle truncate">
                {a.authorRole} · {formatRelative(a.publishedAt, DEMO_NOW)}
              </span>
            </div>
            <p className="mt-1 line-clamp-1 text-sm font-medium">{a.title}</p>
            <div className="text-muted mt-0.5 flex items-center gap-3 text-xs">
              {a.deadline && (
                <span className="inline-flex items-center gap-1">
                  <Clock aria-hidden className="size-3" /> Due {formatRelative(a.deadline, DEMO_NOW)}
                </span>
              )}
              {a.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Paperclip aria-hidden className="size-3" /> {a.attachments.length}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const KIND_LABEL: Record<PendingApproval["kind"], string> = {
  correction: "Attendance correction",
  late_submission: "Late attendance",
  od: "On-duty leave",
  medical: "Medical leave",
};

export function ApprovalList({ items, now }: { items: PendingApproval[]; now: Date }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Queue is clear"
        description="No approvals are waiting on you."
        className="py-8"
      />
    );
  }
  return (
    <ul className="divide-border divide-y">
      {items.map((a) => (
        <li key={a.id}>
          <Link
            href={`/approvals#${a.id}`}
            className="hover:bg-surface-muted flex items-start gap-3 px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{a.title}</p>
              <p className="text-2xs text-subtle">
                {KIND_LABEL[a.kind]} · {a.requester}
              </p>
            </div>
            <span className={cn("text-2xs shrink-0 font-medium", a.overdue ? "text-danger" : "text-muted")}>
              {a.overdue ? "SLA breached" : `Due ${formatRelative(a.dueAt, now)}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
