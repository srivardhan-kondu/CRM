import { CheckCircle2, Clock, Construction, Eye, Paperclip, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { RiskBadge, SeverityBadge } from "@/components/patterns/status";
import { Avatar } from "@/components/ui/misc";
import type { Announcement } from "@/domains/announcements/types";
import type { Student } from "@/domains/students/types";
import { cn, formatRelative } from "@/lib/utils";
import { EmptyState } from "./empty-state";

/** A section of a dashboard with a quiet heading and an optional link. */
export function Panel({
  title,
  description,
  href,
  hrefLabel = "View all",
  children,
  flush,
  className,
}: {
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("border-border bg-surface flex flex-col rounded-lg border", className)}>
      <header className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-foreground text-sm font-semibold">{title}</h2>
          {description && <p className="text-muted text-xs">{description}</p>}
        </div>
        {href && (
          <Link href={href} className="text-brand shrink-0 text-xs font-medium hover:underline">
            {hrefLabel}
          </Link>
        )}
      </header>
      <div className={cn("flex-1", flush ? "pb-1" : "px-5 pb-4")}>{children}</div>
    </section>
  );
}

type NoticeLike = Pick<
  Announcement,
  | "id"
  | "title"
  | "summary"
  | "severity"
  | "authorRole"
  | "publishedAt"
  | "deadline"
  | "requiresAck"
  | "attachments"
> & { read?: boolean; acknowledged?: boolean; addressed?: boolean };

/** A notice in a list: priority, author, freshness and what it asks of the reader. */
export function AnnouncementCard({ a, now }: { a: NoticeLike; now: Date }) {
  const unread = a.addressed !== false && a.read === false;
  return (
    <Link
      href={`/announcements?view=all&id=${a.id}`}
      className="hover:bg-surface-muted block px-5 py-3.5 transition-colors"
    >
      <div className="flex items-center gap-2">
        {unread && <span className="bg-brand size-2 shrink-0 rounded-full" aria-label="Unread" />}
        <SeverityBadge severity={a.severity} />
        <span className="text-muted truncate text-sm">
          {a.authorRole} · {formatRelative(a.publishedAt, now)}
        </span>
      </div>
      <p
        className={cn(
          "text-foreground mt-1 line-clamp-2 text-[17px] leading-snug",
          unread ? "font-semibold" : "font-medium",
        )}
      >
        {a.title}
      </p>
      <p className="text-muted mt-0.5 line-clamp-2 text-[15px]">{a.summary}</p>
      <div className="text-muted mt-1.5 flex flex-wrap gap-4 text-sm">
        {a.deadline && new Date(a.deadline) > now && (
          <span className="text-warning-soft-foreground inline-flex items-center gap-1">
            <Clock aria-hidden className="size-3" /> Due {formatRelative(a.deadline, now)}
          </span>
        )}
        {a.requiresAck && a.addressed !== false && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              a.acknowledged ? "text-success-soft-foreground" : "text-warning-soft-foreground",
            )}
          >
            <CheckCircle2 aria-hidden className="size-3" /> {a.acknowledged ? "Acknowledged" : "Acknowledge"}
          </span>
        )}
        {a.addressed === false && (
          <span className="inline-flex items-center gap-1">
            <Eye aria-hidden className="size-3" /> In your scope
          </span>
        )}
        {a.attachments.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Paperclip aria-hidden className="size-3" /> {a.attachments.length}
          </span>
        )}
      </div>
    </Link>
  );
}

export function AnnouncementList({ items, now }: { items: NoticeLike[]; now: Date }) {
  if (items.length === 0)
    return (
      <EmptyState
        title="No active notices"
        description="Notices addressed to you will appear here."
        compact
      />
    );
  return (
    <ul className="divide-border divide-y">
      {items.map((a) => (
        <li key={a.id}>
          <AnnouncementCard a={a} now={now} />
        </li>
      ))}
    </ul>
  );
}

/** Students needing intervention, each with the factors behind the flag — never a bare score. */
export function StudentRiskCard({ students, empty }: { students: Student[]; empty: string }) {
  if (students.length === 0)
    return <EmptyState tone="success" title="No one flagged" description={empty} compact />;
  return (
    <ul className="divide-border divide-y">
      {students.map((s) => (
        <li key={s.id}>
          <Link
            href={`/students/${s.id}`}
            className="hover:bg-surface-muted flex items-start gap-3 px-5 py-3 transition-colors"
          >
            <Avatar name={s.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="truncate text-sm font-medium">{s.name}</span>
                <span className="text-subtle font-mono text-xs">{s.studentNumber}</span>
                <span className="text-subtle text-xs">{s.sectionLabel}</span>
              </div>
              <p className="text-muted mt-0.5 text-xs">
                {s.risk.factors.map((f) => `${f.label} — ${f.detail}`).join(" · ")}
              </p>
            </div>
            <RiskBadge level={s.risk.level} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** A shortcut to a frequent task. */
export function QuickAction({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="border-border bg-surface hover:border-brand/40 hover:bg-brand-soft/30 flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
    >
      <span className="bg-brand-soft text-brand flex size-8 shrink-0 items-center justify-center rounded-md">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="text-foreground block truncate text-sm font-medium">{label}</span>
        {hint && <span className="text-subtle block truncate text-xs">{hint}</span>}
      </span>
    </Link>
  );
}

/** A module that arrives in a later phase: says what it will show, never shows invented numbers. */
export function PlannedCard({
  title,
  phase,
  description,
}: {
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <section className="border-border-strong rounded-lg border border-dashed px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        <span className="text-subtle inline-flex items-center gap-1 text-xs font-medium">
          <Construction aria-hidden className="size-3.5" /> Phase {phase}
        </span>
      </div>
      <p className="text-muted mt-1 text-xs">{description}</p>
    </section>
  );
}

/** Recent activity: what happened, when, newest first. */
export function ActivityList({
  items,
  now,
}: {
  items: { id: string; at: string; title: string; detail: string; href: string }[];
  now: Date;
}) {
  if (items.length === 0)
    return (
      <EmptyState
        title="No recent activity"
        description="Notices, messages and decisions in your scope appear here."
        compact
      />
    );
  return (
    <ol className="px-5 pb-3">
      {items.map((i) => (
        <li key={i.id} className="border-border relative border-l pb-3 pl-4 last:pb-0">
          <span
            aria-hidden
            className="bg-border-strong absolute top-1.5 -left-[4px] size-[7px] rounded-full"
          />
          <Link href={i.href} className="hover:text-brand block">
            <p className="line-clamp-1 text-[15px]">{i.title}</p>
            <p className="text-subtle text-xs">
              {i.detail} · <time dateTime={i.at}>{formatRelative(i.at, now)}</time>
            </p>
          </Link>
        </li>
      ))}
    </ol>
  );
}
