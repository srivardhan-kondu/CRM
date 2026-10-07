import { BellRing, FileText, Megaphone, Pencil, Trash2, Undo2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  deleteDraftAction,
  recallNoticeAction,
  remindAction,
  withdrawNoticeAction,
} from "@/app/(app)/announcements/actions";
import { WidgetCard } from "@/components/dashboard/widgets";
import { ActionButton, ReasonDialog } from "@/components/communication/controls";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/components/communication/labels";
import { PageHeader } from "@/components/patterns/page-header";
import { SeverityBadge } from "@/components/patterns/status";
import { EmptyState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/misc";
import type { AnnouncementRecord } from "@/domains/announcements/load";
import {
  authoredNotices,
  engagementFor,
  managedNotice,
  type EngagementView,
} from "@/domains/announcements/repository";
import { canRemind, formatBytes } from "@/domains/announcements/rules";
import { isExpired } from "@/domains/announcements/visibility";
import { requireAuth } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import { cn, formatDateTime, formatNumber, formatRelative, pluralize, sectionLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Sent announcements" };

const pct = (n: number, of: number) => (of === 0 ? 0 : (n / of) * 100);

export default async function SentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await requireAuth();
  const { id } = await searchParams;
  const now = institutionNow();
  const [mine, selected] = await Promise.all([
    authoredNotices(authed),
    typeof id === "string" ? managedNotice(authed, id) : null,
  ]);
  const engagement = selected ? await engagementFor(authed, selected) : null;
  const order = { pending: 0, rejected: 1, draft: 2, published: 3, withdrawn: 4 } as const;
  const sorted = [...mine].sort(
    (a, b) => order[a.status] - order[b.status] || b.publishedAt.localeCompare(a.publishedAt),
  );

  return (
    <>
      <PageHeader
        title="Sent announcements"
        breadcrumbs={[{ label: "Announcements", href: "/announcements" }, { label: "Sent" }]}
        description="Your notices in every state, and who has read and acknowledged them."
        actions={
          <Button asChild>
            <Link href="/announcements/new">New announcement</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section
          aria-label="Your notices"
          className={cn(
            "border-border bg-surface rounded-lg border shadow-xs",
            selected && "hidden lg:block",
          )}
        >
          {sorted.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Nothing sent yet"
              description="Notices you write appear here with their status."
            />
          ) : (
            <ul className="divide-border divide-y">
              {sorted.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/announcements/sent?id=${a.id}`}
                    aria-current={selected?.id === a.id ? "true" : undefined}
                    className={cn(
                      "hover:bg-surface-muted block border-l-2 px-4 py-3",
                      selected?.id === a.id ? "border-l-brand bg-brand-soft/40" : "border-l-transparent",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge a={a} now={now} />
                      <span className="text-2xs text-subtle ml-auto">
                        {formatRelative(a.publishedAt, now)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm font-medium">{a.title}</p>
                    <p className="text-2xs text-subtle mt-0.5">{a.audienceLabel}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Notice" className={cn("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <SentDetail
              a={selected}
              engagement={engagement}
              now={now}
              mine={selected.authorId === authed.ctx.userId}
            />
          ) : (
            <div className="border-border-strong rounded-lg border border-dashed">
              <EmptyState
                icon={Megaphone}
                title={typeof id === "string" ? "Notice unavailable" : "Select a notice"}
                description={
                  typeof id === "string"
                    ? "Only the author and the approvers for its audience see a notice's responses."
                    : "Pick a notice to see its reach, reads and acknowledgements."
                }
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function SentDetail({
  a,
  engagement: e,
  now,
  mine,
}: {
  a: AnnouncementRecord;
  engagement: EngagementView | null;
  now: Date;
  mine: boolean;
}) {
  const live = a.status === "published" && !isExpired(a, now);
  return (
    <div className="space-y-5">
      <article className="border-border bg-surface rounded-lg border p-5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge a={a} now={now} />
          <SeverityBadge severity={a.severity} />
          <Badge tone="outline">{CATEGORY_LABEL[a.category]}</Badge>
          {a.status === "published" && isExpired(a, now) && <Badge tone="neutral">Expired</Badge>}
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{a.title}</h2>
        <p className="text-muted mt-1 text-sm">
          {a.audienceLabel} · {a.author} ·{" "}
          {a.status === "published" || a.status === "withdrawn"
            ? `published ${formatDateTime(a.publishedAt)}`
            : a.submittedAt
              ? `submitted ${formatDateTime(a.submittedAt)}`
              : `written ${formatDateTime(a.createdAt)}`}
        </p>
        <p className="mt-3 text-sm">{a.summary}</p>
        {a.attachments.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {a.attachments.map((f) => (
              <li key={f.id}>
                <a
                  href={`/api/announcements/${a.id}/attachments/${f.id}`}
                  className="border-border hover:bg-surface-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                >
                  <FileText aria-hidden className="size-3.5" /> {f.name} · {formatBytes(f.sizeBytes)}
                </a>
              </li>
            ))}
          </ul>
        )}
        {a.status === "rejected" && a.decisionNote && (
          <p className="bg-danger-soft text-danger-soft-foreground mt-3 rounded-md px-3 py-2 text-sm">
            Returned: “{a.decisionNote}”
          </p>
        )}
        {a.status === "withdrawn" && (
          <p className="text-muted mt-3 text-sm">
            Withdrawn {a.withdrawnAt && formatDateTime(a.withdrawnAt)} — “{a.withdrawReason}”
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {mine && (a.status === "draft" || a.status === "rejected") && (
            <Button size="sm" asChild>
              <Link href={`/announcements/new?draft=${a.id}`}>
                <Pencil /> Edit and send
              </Link>
            </Button>
          )}
          {mine && a.status === "draft" && (
            <ActionButton action={deleteDraftAction} hidden={{ id: a.id }} variant="ghost" icon={<Trash2 />}>
              Delete draft
            </ActionButton>
          )}
          {mine && a.status === "pending" && (
            <ActionButton
              action={recallNoticeAction}
              hidden={{ id: a.id }}
              variant="secondary"
              icon={<Undo2 />}
            >
              Recall to drafts
            </ActionButton>
          )}
          {live && a.requiresAck && (
            <ActionButton
              action={remindAction}
              hidden={{ id: a.id }}
              variant="secondary"
              icon={<BellRing />}
              label="Remind those who haven't acknowledged"
            >
              {canRemind(a.remindedAt, now) ? "Remind pending" : "Reminded today"}
            </ActionButton>
          )}
          {a.status === "published" && (
            <ReasonDialog
              action={withdrawNoticeAction}
              hidden={{ id: a.id }}
              trigger={
                <Button size="sm" variant="ghost">
                  <XCircle /> Withdraw
                </Button>
              }
              title="Withdraw this notice?"
              description="Recipients stop seeing it, and emails that haven't left are cancelled. To correct a notice, withdraw it and issue a new one."
              submit="Withdraw"
              danger
            />
          )}
        </div>
      </article>
      {e && <Engagement e={e} ack={a.requiresAck} />}
    </div>
  );
}

function Rate({ label, n, of }: { label: string; n: number; of: number }) {
  const p = pct(n, of);
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular font-medium">
          {formatNumber(n)} / {formatNumber(of)} · {p.toFixed(0)}%
        </span>
      </div>
      <Meter
        value={p}
        label={`${label}: ${p.toFixed(0)}%`}
        tone={p >= 80 ? "success" : p >= 50 ? "brand" : "warning"}
        className="mt-1"
      />
    </div>
  );
}

function Engagement({ e, ack }: { e: EngagementView; ack: boolean }) {
  const email = Object.entries(e.email).filter(([, n]) => n);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {e.students.delivered > 0 && (
          <WidgetCard title="Students" description={pluralize(e.students.delivered, "recipient")}>
            <div className="space-y-3">
              <Rate label="Read" n={e.students.read} of={e.students.delivered} />
              {ack && <Rate label="Acknowledged" n={e.students.acknowledged} of={e.students.delivered} />}
            </div>
          </WidgetCard>
        )}
        {e.guardians.delivered > 0 && (
          <WidgetCard title="Guardians" description={pluralize(e.guardians.delivered, "household")}>
            <div className="space-y-3">
              <Rate label="Read" n={e.guardians.read} of={e.guardians.delivered} />
              {ack && <Rate label="Acknowledged" n={e.guardians.acknowledged} of={e.guardians.delivered} />}
            </div>
          </WidgetCard>
        )}
        {(e.staff.read > 0 || (e.students.delivered === 0 && e.guardians.delivered === 0)) && (
          <WidgetCard title="Staff" description="Counted as they open it">
            <p className="text-sm">
              {pluralize(e.staff.read, "staff member")} read · {formatNumber(e.staff.acknowledged)}{" "}
              acknowledged
            </p>
          </WidgetCard>
        )}
        {email.length > 0 && (
          <WidgetCard title="Email" description="Through the notification outbox">
            <ul className="flex flex-wrap gap-2 text-xs">
              {email.map(([status, n]) => (
                <li key={status}>
                  <Badge
                    tone={
                      status === "sent"
                        ? "success"
                        : status === "held"
                          ? "warning"
                          : status === "failed"
                            ? "danger"
                            : "neutral"
                    }
                  >
                    {formatNumber(n!)} {status === "suppressed" ? "no address" : status}
                  </Badge>
                </li>
              ))}
            </ul>
          </WidgetCard>
        )}
      </div>
      {e.sections.length > 1 && (
        <WidgetCard
          title="By section"
          description={ack ? "Students who read and acknowledged" : "Students who read it"}
          flush
        >
          <table className="w-full text-sm">
            <thead className="text-2xs text-subtle text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Section</th>
                <th className="px-4 py-2 text-right font-medium">Students</th>
                <th className="px-4 py-2 font-medium">Read</th>
                {ack && <th className="px-4 py-2 font-medium">Acknowledged</th>}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {e.sections.map((s) => (
                <tr key={s.code}>
                  <td className="px-4 py-2 font-medium">{sectionLabel(s.code)}</td>
                  <td className="tabular px-4 py-2 text-right">{s.delivered}</td>
                  <td className="px-4 py-2">
                    <Meter value={pct(s.read, s.delivered)} label={`${sectionLabel(s.code)} read`} />
                  </td>
                  {ack && (
                    <td className="px-4 py-2">
                      <Meter
                        value={pct(s.acknowledged, s.delivered)}
                        tone="success"
                        label={`${sectionLabel(s.code)} acknowledged`}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </WidgetCard>
      )}
      {ack && e.pendingTotal > 0 && e.pendingTotal <= 60 && (
        <WidgetCard title="Yet to acknowledge" description={pluralize(e.pendingTotal, "recipient")} flush>
          <ul className="divide-border divide-y text-sm">
            {e.pending.map((p) => (
              <li key={`${p.kind}-${p.studentNumber}`} className="flex items-center gap-3 px-4 py-2">
                <span className="text-subtle w-20 font-mono text-xs">{p.studentNumber}</span>
                <span className="flex-1">{p.kind === "guardian" ? `Guardian of ${p.name}` : p.name}</span>
                <span className="text-2xs text-subtle">{sectionLabel(p.sectionCode)}</span>
                <Badge tone={p.read ? "info" : "neutral"}>{p.read ? "Read" : "Unread"}</Badge>
              </li>
            ))}
          </ul>
        </WidgetCard>
      )}
    </>
  );
}

/** Status, with "Scheduled" for a published notice whose publication time is still ahead. */
function StatusBadge({ a, now }: { a: AnnouncementRecord; now: Date }) {
  if (a.status === "published" && new Date(a.publishedAt) > now)
    return <Badge tone="info">Scheduled · {formatDateTime(a.publishedAt)}</Badge>;
  return <Badge tone={STATUS_LABEL[a.status].tone}>{STATUS_LABEL[a.status].label}</Badge>;
}
