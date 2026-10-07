import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { WidgetCard } from "@/components/dashboard/widgets";
import { decideNoticeAction } from "@/app/(app)/announcements/actions";
import { DecideButtons, WithdrawButton } from "@/components/attendance/request-controls";
import { DecideWithNote } from "@/components/exams/decide";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { pendingForApproval } from "@/domains/announcements/repository";
import { approvalQueue, type ApprovalItem } from "@/domains/attendance/repository";
import { requireAuth } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import { cn, formatDateTime, formatRelative, pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Approvals" };

const STATUS_TONE: Record<ApprovalItem["status"], BadgeTone> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

const KIND: Record<ApprovalItem["kind"], string> = {
  correction: "Attendance correction",
  late_submission: "Late attendance",
  od: "On-duty leave",
  medical: "Medical leave",
};

function ItemCard({ item, now, actions }: { item: ApprovalItem; now: Date; actions?: React.ReactNode }) {
  return (
    <li id={item.id} className="scroll-mt-20 px-4 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{KIND[item.kind]}</Badge>
            <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
            {item.status === "pending" && (
              <span className={cn("text-2xs font-medium", item.overdue ? "text-danger" : "text-muted")}>
                {item.overdue
                  ? `Overdue — was due ${formatRelative(item.dueAt, now)}`
                  : `Due ${formatRelative(item.dueAt, now)}`}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm font-medium">
            {item.href ? (
              <Link href={item.href} className="hover:text-brand">
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </p>
          <p className="text-muted text-xs">
            {item.detail} · {item.requester} · {formatDateTime(item.requestedAt)}
          </p>
          <p className="mt-2 text-sm">“{item.reason}”</p>
          {item.proposedStatus === "cancelled" && (
            <p className="text-muted mt-1 text-xs">Proposes: class not held — {item.cancelReason}</p>
          )}
          {item.changes && item.changes.length > 0 && item.proposedStatus !== "cancelled" && (
            <details className="mt-2" open={item.kind === "correction"}>
              <summary className="text-brand cursor-pointer text-xs font-medium">
                {item.kind === "correction"
                  ? pluralize(item.changes.length, "mark change")
                  : `${item.changes.filter((c) => c.to === "present").length} present · ${item.changes.filter((c) => c.to === "absent").length} absent`}
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {item.changes.map((c) => (
                  <li key={c.studentId} className="flex gap-2">
                    <span className="text-subtle w-20 font-mono">{c.studentNumber}</span>
                    <span className="flex-1">{c.name}</span>
                    <span>
                      {c.from ? `${c.from} → ` : ""}
                      <span
                        className={cn(
                          "font-medium",
                          c.to === "absent" ? "text-danger" : "text-success-soft-foreground",
                        )}
                      >
                        {c.to}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {item.status !== "pending" && item.status !== "withdrawn" && (
            <p className="text-muted mt-2 text-xs">
              {item.status === "approved" ? "Approved" : "Rejected"} by {item.decidedBy ?? "—"}
              {item.decidedAt && ` · ${formatDateTime(item.decidedAt)}`}
              {item.decisionNote && ` — “${item.decisionNote}”`}
            </p>
          )}
        </div>
        {actions}
      </div>
    </li>
  );
}

export default async function ApprovalsPage() {
  const authed = await requireAuth();
  const [q, notices] = await Promise.all([approvalQueue(authed), pendingForApproval(authed)]);
  const now = institutionNow();

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Announcements, attendance corrections, late submissions and student leave. Nobody approves their own request."
      />
      <div className="space-y-5">
        {notices.length > 0 && (
          <WidgetCard
            title="Announcements awaiting approval"
            description={`${pluralize(notices.length, "notice")} · nothing reaches recipients until you approve it`}
            flush
          >
            <ul className="divide-border divide-y">
              {notices.map((a) => (
                <li key={a.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="brand">Announcement</Badge>
                        <Badge tone="outline">{a.audienceLabel}</Badge>
                        {a.requiresAck && <Badge tone="neutral">Acknowledgement</Badge>}
                        {a.sendEmail && <Badge tone="neutral">Email</Badge>}
                      </div>
                      <p className="mt-1.5 text-sm font-medium">{a.title}</p>
                      <p className="text-muted text-xs">
                        {a.author} · {a.authorRole} · {a.submittedAt && formatDateTime(a.submittedAt)} ·
                        reaches{" "}
                        {[
                          a.reach.students && pluralize(a.reach.students, "student"),
                          a.reach.guardians && pluralize(a.reach.guardians, "guardian household"),
                          a.reach.staff && "staff",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      <p className="mt-2 text-sm">{a.summary}</p>
                      {a.body.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-brand cursor-pointer text-xs font-medium">
                            Full text
                          </summary>
                          <div className="mt-1 space-y-2 text-sm whitespace-pre-line">
                            {a.body.map((p, i) => (
                              <p key={i}>{p}</p>
                            ))}
                          </div>
                        </details>
                      )}
                      {a.attachments.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-2 text-xs">
                          {a.attachments.map((f) => (
                            <a
                              key={f.id}
                              className="text-brand hover:underline"
                              href={`/api/announcements/${a.id}/attachments/${f.id}`}
                            >
                              {f.name}
                            </a>
                          ))}
                        </p>
                      )}
                    </div>
                    <DecideWithNote
                      action={decideNoticeAction}
                      hidden={{ id: a.id }}
                      label={`“${a.title}”`}
                      approve={{ value: "approved", text: "Approve & publish" }}
                      other={{ value: "rejected", text: "Return" }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </WidgetCard>
        )}
        {q.approver && (
          <WidgetCard
            title="Waiting for you"
            description={`${pluralize(q.waiting.length, "item")} · ${q.waiting.filter((i) => i.overdue).length} overdue · most urgent first`}
            flush
          >
            {q.waiting.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Queue is clear"
                description="Nothing is waiting on your decision."
                className="py-8"
              />
            ) : (
              <ul className="divide-border divide-y">
                {q.waiting.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    now={now}
                    actions={<DecideButtons type={item.type} id={item.id} label={item.title} />}
                  />
                ))}
              </ul>
            )}
          </WidgetCard>
        )}
        <WidgetCard title="Your requests" description="What you submitted, and what happened to it" flush>
          {q.mine.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No requests"
              description="Corrections and leave you submit appear here."
              className="py-8"
            />
          ) : (
            <ul className="divide-border divide-y">
              {q.mine.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  now={now}
                  actions={
                    item.status === "pending" ? <WithdrawButton type={item.type} id={item.id} /> : undefined
                  }
                />
              ))}
            </ul>
          )}
        </WidgetCard>
        {q.approver && q.decided.length > 0 && (
          <WidgetCard title="Recently decided" description="In your scope" flush>
            <ul className="divide-border divide-y">
              {q.decided.map((item) => (
                <ItemCard key={item.id} item={item} now={now} />
              ))}
            </ul>
          </WidgetCard>
        )}
      </div>
    </>
  );
}
