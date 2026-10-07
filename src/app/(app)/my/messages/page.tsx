import { CheckCircle2, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { after } from "next/server";
import { AcknowledgeMessage } from "@/components/communication/acknowledge-message";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { guardianInbox, markGuardianMessagesRead } from "@/domains/messages/repository";
import { TEMPLATES } from "@/domains/messages/templates";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages from college" };

export default async function MyMessagesPage() {
  const authed = await requireAuth();
  const header = (
    <PageHeader
      title="Messages from college"
      description="Personal messages about your child from the class incharge, HOD or principal. Acknowledge them so the sender knows you've read them."
    />
  );
  if (!authed.ctx.links.some((l) => l.relation === "guardian"))
    return (
      <>
        {header}
        <PermissionState description="Messages here are for guardians of a student." />
      </>
    );
  const messages = await guardianInbox(authed);
  const unread = messages.filter((m) => !m.readAt).map((m) => m.id);
  if (unread.length > 0)
    after(() =>
      markGuardianMessagesRead(authed, unread).catch((err) => console.error("[messages] read", err)),
    );

  return (
    <>
      {header}
      {messages.length === 0 ? (
        <div className="border-border bg-surface rounded-lg border shadow-xs">
          <EmptyState
            icon={MessageSquare}
            title="No messages"
            description="Messages from the college about your child will appear here."
          />
        </div>
      ) : (
        <ul className="space-y-4">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "border-border bg-surface rounded-lg border p-5 shadow-xs",
                !m.readAt && "border-l-brand border-l-4",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{TEMPLATES[m.template].label}</Badge>
                {!m.readAt && <Badge tone="info">New</Badge>}
                <span className="text-2xs text-subtle ml-auto">
                  {m.senderName}, {m.senderRole} · {formatDateTime(m.sentAt)}
                </span>
              </div>
              <h2 className="mt-2 text-base font-semibold">{m.subject}</h2>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{m.body}</p>
              <div className="border-border mt-4 border-t pt-4">
                {m.acknowledgedAt ? (
                  <p className="text-success-soft-foreground flex items-center gap-1.5 text-sm">
                    <CheckCircle2 aria-hidden className="size-4" /> Acknowledged{" "}
                    {formatDateTime(m.acknowledgedAt)}
                    {m.reply && <span className="text-muted"> — you replied “{m.reply}”</span>}
                  </p>
                ) : (
                  <AcknowledgeMessage id={m.id} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
