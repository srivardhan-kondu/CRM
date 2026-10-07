import { CheckCircle2, Eye, Mail, MailX, MessageSquareReply, Send } from "lucide-react";
import { EmptyState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import type { MessageRow } from "@/domains/messages/load";
import { TEMPLATES } from "@/domains/messages/templates";
import { formatDateTime } from "@/lib/utils";

/** Delivery state of one guardian message, most advanced first. */
export function MessageStatus({ m }: { m: MessageRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {m.reply ? (
        <Badge tone="success">
          <MessageSquareReply /> Replied
        </Badge>
      ) : m.acknowledgedAt ? (
        <Badge tone="success">
          <CheckCircle2 /> Acknowledged
        </Badge>
      ) : m.readAt ? (
        <Badge tone="info">
          <Eye /> Read
        </Badge>
      ) : (
        <Badge tone="neutral">
          <Send /> Delivered
        </Badge>
      )}
      {m.email === "suppressed" ? (
        <Badge tone="warning">
          <MailX /> No email on record
        </Badge>
      ) : m.email === "held" ? (
        <Badge tone="warning">
          <Mail /> Email held (quiet hours)
        </Badge>
      ) : m.email === "sent" ? (
        <Badge tone="outline">
          <Mail /> Emailed
        </Badge>
      ) : null}
    </span>
  );
}

export function GuardianMessageList({
  messages,
  showStudent,
}: {
  messages: MessageRow[];
  showStudent?: boolean;
}) {
  if (messages.length === 0)
    return (
      <EmptyState
        icon={Send}
        title="No messages yet"
        description="Messages sent to guardians appear here."
        className="py-8"
      />
    );
  return (
    <ul className="divide-border divide-y">
      {messages.map((m) => (
        <li key={m.id} className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{TEMPLATES[m.template].label}</Badge>
            <span className="text-2xs text-subtle">
              {m.senderName} · {formatDateTime(m.sentAt)}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium">
            {showStudent && <span className="text-subtle mr-1 font-mono text-xs">{m.studentNumber}</span>}
            {m.subject}
          </p>
          <div className="mt-1.5">
            <MessageStatus m={m} />
          </div>
          {m.reply && <p className="bg-surface-muted mt-2 rounded-md px-3 py-2 text-sm">“{m.reply}”</p>}
        </li>
      ))}
    </ul>
  );
}
