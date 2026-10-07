import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  History,
  Inbox,
  Mail,
  Megaphone,
  Paperclip,
  PenSquare,
  Send,
  Target,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { z } from "zod";
import { acknowledgeNoticeAction, toggleSavedAction } from "@/app/(app)/announcements/actions";
import { ActionButton } from "@/components/communication/controls";
import { CATEGORY_LABEL } from "@/components/communication/labels";
import { PageHeader } from "@/components/patterns/page-header";
import { SeverityBadge } from "@/components/patterns/status";
import { EmptyState, PhaseNote } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canManageNotice } from "@/domains/announcements/guards";
import { getInboxItem, inboxCounts, listInbox, recordRead } from "@/domains/announcements/repository";
import { formatBytes } from "@/domains/announcements/rules";
import type { InboxItem, InboxView } from "@/domains/announcements/types";
import { isExpired } from "@/domains/announcements/visibility";
import { requireAuth } from "@/lib/authz/context";
import { holdsAnywhere } from "@/lib/authz/engine";
import { institutionNow } from "@/lib/clock";
import { cn, formatDateTime, formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Announcements" };

const VIEWS: { key: InboxView; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "mine", label: "All active" },
  { key: "exams", label: "Exams" },
  { key: "jobs", label: "Jobs" },
  { key: "saved", label: "Saved" },
  { key: "history", label: "History" },
];

const paramsSchema = z.object({
  view: z.enum(["today", "mine", "exams", "jobs", "saved", "history"]).catch("today"),
  id: z.string().max(80).optional().catch(undefined),
});

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await requireAuth();
  const canPublish = holdsAnywhere(authed.ctx, "announcement:publish");
  const raw = await searchParams;
  const { view, id } = paramsSchema.parse({
    view: raw.view ?? "today",
    id: typeof raw.id === "string" ? raw.id : undefined,
  });
  const now = institutionNow();

  const [items, counts, selected] = await Promise.all([
    listInbox(authed, view),
    inboxCounts(authed),
    id ? getInboxItem(authed, id) : null,
  ]);
  if (selected && selected.addressed && !selected.read)
    after(() =>
      recordRead(authed, selected).catch((err) => console.error("[announcements] read receipt", err)),
    );
  const href = (v: InboxView, i?: string) => `/announcements?view=${v}${i ? `&id=${i}` : ""}`;

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Official notices addressed to you — one place instead of WhatsApp groups and email threads."
        actions={
          canPublish ? (
            <div className="flex gap-2">
              <Button variant="secondary" asChild>
                <Link href="/announcements/sent">
                  <Send /> Sent
                </Link>
              </Button>
              <Button asChild>
                <Link href="/announcements/new">
                  <PenSquare /> New announcement
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <div
        className="border-border mb-4 flex gap-1 overflow-x-auto border-b"
        role="tablist"
        aria-label="Inbox views"
      >
        {VIEWS.map((v) => {
          const active = v.key === view;
          return (
            <Link
              key={v.key}
              href={href(v.key)}
              role="tab"
              aria-selected={active}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "border-brand text-foreground"
                  : "text-muted hover:text-foreground border-transparent",
              )}
            >
              {v.label}
              {counts[v.key] > 0 && v.key !== "history" && (
                <span
                  className={cn(
                    "text-2xs tabular rounded-full px-1.5",
                    active ? "bg-brand text-brand-foreground" : "bg-surface-muted text-muted",
                  )}
                >
                  {counts[v.key]}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section
          aria-label="Notices"
          className={cn(
            "border-border bg-surface rounded-lg border shadow-xs",
            selected && "hidden lg:block",
          )}
        >
          {items.length === 0 ? (
            <InboxEmpty view={view} />
          ) : (
            <ul className="divide-border divide-y">
              {items.map((a) => {
                const unread = a.addressed && !a.read && selected?.id !== a.id;
                return (
                  <li key={a.id}>
                    <Link
                      href={href(view, a.id)}
                      scroll={false}
                      aria-current={selected?.id === a.id ? "true" : undefined}
                      className={cn(
                        "hover:bg-surface-muted block border-l-2 px-4 py-3 transition-colors",
                        selected?.id === a.id ? "border-l-brand bg-brand-soft/40" : "border-l-transparent",
                        a.severity === "critical" && selected?.id !== a.id && "border-l-danger",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {unread && (
                          <span className="bg-brand size-2 shrink-0 rounded-full" aria-label="Unread" />
                        )}
                        <SeverityBadge severity={a.severity} />
                        <span className="text-2xs text-subtle truncate">{CATEGORY_LABEL[a.category]}</span>
                        <time dateTime={a.publishedAt} className="text-2xs text-subtle ml-auto shrink-0">
                          {formatRelative(a.publishedAt, now)}
                        </time>
                      </div>
                      <p
                        className={cn(
                          "mt-1.5 line-clamp-2 text-sm",
                          unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {a.title}
                      </p>
                      <p className="text-muted mt-0.5 line-clamp-1 text-xs">{a.summary}</p>
                      <div className="text-2xs text-subtle mt-1.5 flex flex-wrap items-center gap-3">
                        <span>{a.authorRole}</span>
                        {!a.addressed && (
                          <span className="inline-flex items-center gap-1">
                            <Eye aria-hidden className="size-3" /> In your scope
                          </span>
                        )}
                        {a.deadline && !isExpired(a, now) && (
                          <span className="text-warning-soft-foreground inline-flex items-center gap-1">
                            <Clock aria-hidden className="size-3" /> Due {formatRelative(a.deadline, now)}
                          </span>
                        )}
                        {a.requiresAck && a.addressed && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1",
                              a.acknowledged
                                ? "text-success-soft-foreground"
                                : "text-warning-soft-foreground",
                            )}
                          >
                            <CheckCircle2 aria-hidden className="size-3" />
                            {a.acknowledged ? "Acknowledged" : "Acknowledgement required"}
                          </span>
                        )}
                        {a.attachments.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip aria-hidden className="size-3" /> {a.attachments.length}
                          </span>
                        )}
                        {a.saved && <BookmarkCheck aria-label="Saved" className="size-3" />}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Notice detail" className={cn("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <NoticeDetail
              a={selected}
              now={now}
              backHref={href(view)}
              showAudience={authed.ctx.assignments.some((x) => x.scopeMode !== "linked")}
              manageable={canManageNotice(authed.ctx, authed.tree, selected)}
            />
          ) : id ? (
            <div className="border-border bg-surface rounded-lg border shadow-xs">
              <EmptyState
                icon={Inbox}
                title="Notice unavailable"
                description="This notice doesn't exist, was withdrawn, or wasn't addressed to you."
              />
            </div>
          ) : (
            <div className="border-border-strong rounded-lg border border-dashed">
              <EmptyState
                icon={Megaphone}
                title="Select a notice"
                description="Pick a notice from the list to read it in full, with attachments, deadlines and required actions."
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function InboxEmpty({ view }: { view: InboxView }) {
  const states: Record<InboxView, { icon: typeof Inbox; title: string; description: string }> = {
    saved: {
      icon: Bookmark,
      title: "No saved notices",
      description: "Save a notice from its detail view to keep it here for quick access.",
    },
    history: {
      icon: History,
      title: "No past notices",
      description: "Expired notices you received will be kept here for reference.",
    },
    jobs: {
      icon: Inbox,
      title: "No open opportunities",
      description: "Placement and internship notices you're eligible for will appear here.",
    },
    exams: {
      icon: Inbox,
      title: "No exam notices",
      description: "Exam schedules, hall tickets and results notices will appear here.",
    },
    mine: {
      icon: Inbox,
      title: "No active notices",
      description: "Notices addressed to you will appear here.",
    },
    today: {
      icon: Inbox,
      title: "You're all caught up",
      description: "Nothing new needs your attention today. Check “All active” for everything current.",
    },
  };
  const s = states[view];
  return <EmptyState icon={s.icon} title={s.title} description={s.description} />;
}

function NoticeDetail({
  a,
  now,
  backHref,
  showAudience,
  manageable,
}: {
  a: InboxItem;
  now: Date;
  backHref: string;
  showAudience: boolean;
  manageable: boolean;
}) {
  const expired = isExpired(a, now);
  return (
    <article className="border-border bg-surface rounded-lg border shadow-xs">
      <div className="border-border border-b p-5">
        <Link
          href={backHref}
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1 text-xs lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-3" /> All notices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={a.severity} />
          <Badge tone="outline">{CATEGORY_LABEL[a.category]}</Badge>
          {expired && <Badge tone="neutral">Expired</Badge>}
          {!a.addressed && (
            <Badge tone="info">
              <Eye /> In your scope, not addressed to you
            </Badge>
          )}
          <div className="ml-auto flex gap-2">
            {manageable && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/announcements/sent?id=${a.id}`}>
                  <BarChart3 /> Reach &amp; responses
                </Link>
              </Button>
            )}
            <ActionButton
              action={toggleSavedAction}
              hidden={{ id: a.id }}
              variant="ghost"
              icon={a.saved ? <BookmarkCheck /> : <Bookmark />}
            >
              {a.saved ? "Saved" : "Save"}
            </ActionButton>
          </div>
        </div>
        <h2 className="mt-2 text-lg leading-snug font-semibold tracking-tight">{a.title}</h2>
        <p className="text-muted mt-1 text-sm">
          {a.author} · {a.authorRole} · <time dateTime={a.publishedAt}>{formatDateTime(a.publishedAt)}</time>
        </p>
      </div>

      {a.requiresAck && a.addressed && !expired && (
        <div
          className={cn(
            "border-border flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center",
            a.acknowledged ? "bg-success-soft/40" : "bg-warning-soft/50",
          )}
        >
          <CheckCircle2
            aria-hidden
            className={cn("size-4 shrink-0", a.acknowledged ? "text-success" : "text-warning")}
          />
          <p className="flex-1 text-sm">
            {a.acknowledged ? "You acknowledged this notice." : "This notice requires your acknowledgement."}
          </p>
          {!a.acknowledged && (
            <ActionButton action={acknowledgeNoticeAction} hidden={{ id: a.id }} icon={<CheckCircle2 />}>
              Acknowledge
            </ActionButton>
          )}
        </div>
      )}

      <div className="space-y-5 p-5">
        <p className="text-foreground text-sm font-medium">{a.summary}</p>
        <div className="text-foreground/90 space-y-3 text-sm leading-relaxed whitespace-pre-line">
          {a.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <dl className="bg-surface-muted grid grid-cols-1 gap-3 rounded-md p-4 text-sm sm:grid-cols-2">
          {a.deadline && (
            <div className="flex gap-2">
              <Clock aria-hidden className="text-subtle mt-0.5 size-4" />
              <div>
                <dt className="text-2xs text-subtle">Action deadline</dt>
                <dd className="font-medium">{formatDateTime(a.deadline)}</dd>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <CalendarClock aria-hidden className="text-subtle mt-0.5 size-4" />
            <div>
              <dt className="text-2xs text-subtle">Active until</dt>
              <dd className="font-medium">{a.expiresAt ? formatDateTime(a.expiresAt) : "Until withdrawn"}</dd>
            </div>
          </div>
          {showAudience && (
            <div className="flex gap-2 sm:col-span-2">
              <Target aria-hidden className="text-subtle mt-0.5 size-4" />
              <div>
                <dt className="text-2xs text-subtle">Audience</dt>
                <dd className="font-medium">
                  {a.audienceLabel}
                  {a.sendEmail && (
                    <span className="text-muted ml-2 inline-flex items-center gap-1 text-xs font-normal">
                      <Mail aria-hidden className="size-3" /> also by email
                    </span>
                  )}
                </dd>
              </div>
            </div>
          )}
        </dl>

        {a.attachments.length > 0 && (
          <div>
            <h3 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Attachments</h3>
            <ul className="space-y-2">
              {a.attachments.map((f) => (
                <li key={f.id} className="border-border flex items-center gap-3 rounded-md border px-3 py-2">
                  <FileText aria-hidden className="text-subtle size-4" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{f.name}</p>
                    <p className="text-2xs text-subtle">{formatBytes(f.sizeBytes)}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" asChild>
                    <a
                      href={`/api/announcements/${a.id}/attachments/${f.id}`}
                      aria-label={`Download ${f.name}`}
                      download
                    >
                      <Download />
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {a.cta && !expired && (
          <div className="flex items-center gap-3">
            <Button disabled>{a.cta.label}</Button>
            <PhaseNote phase={a.cta.phase} />
          </div>
        )}
      </div>
    </article>
  );
}
