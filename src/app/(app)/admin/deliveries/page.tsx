import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { WidgetCard } from "@/components/dashboard/widgets";
import { DispatchButton } from "@/components/communication/dispatch-button";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionState } from "@/components/patterns/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
  canDispatch,
  deliveryLog,
  OUTBOX_STATUSES,
  type OutboxStatus,
} from "@/domains/notifications/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Delivery log" };

const TONE: Record<OutboxStatus, BadgeTone> = {
  queued: "info",
  held: "warning",
  sent: "success",
  failed: "danger",
  suppressed: "neutral",
};
const LABEL: Record<OutboxStatus, string> = {
  queued: "Queued",
  held: "Held (quiet hours)",
  sent: "Sent",
  failed: "Failed",
  suppressed: "No address / cancelled",
};
const SOURCE = {
  announcement: "Notice",
  reminder: "Reminder",
  guardian_message: "Guardian message",
} as const;

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await requireAuth();
  const raw = (await searchParams).status;
  const status = OUTBOX_STATUSES.find((s) => s === raw) ?? null;
  const log = await deliveryLog(authed, status);
  const header = (
    <PageHeader
      title="Delivery log"
      description="Every email the institution sends, before and after it leaves. Messages outside 21:00–07:00 leave at once; others wait for 07:00 unless critical."
      actions={log && log.due > 0 && canDispatch(authed) ? <DispatchButton due={log.due} /> : undefined}
    />
  );
  if (!log)
    return (
      <>
        {header}
        <PermissionState description="The delivery log is open to those who read the institution's audit trail." />
      </>
    );

  return (
    <>
      {header}
      <p className="bg-info-soft text-info-soft-foreground mb-4 rounded-md px-3 py-2 text-sm">
        No email provider is configured: “sent” messages are recorded by the log transport and do not leave
        CampusOS. The synthetic demo never emails anyone.
      </p>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Status">
        <Link
          href="/admin/deliveries"
          role="tab"
          aria-selected={!status}
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            !status ? "border-brand text-foreground" : "border-border text-muted",
          )}
        >
          All
        </Link>
        {OUTBOX_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/deliveries?status=${s}`}
            role="tab"
            aria-selected={status === s}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              status === s ? "border-brand text-foreground" : "border-border text-muted",
            )}
          >
            {LABEL[s]} · {formatNumber(log.counts[s] ?? 0)}
          </Link>
        ))}
      </div>
      <WidgetCard title="Latest messages" description="Newest 100" flush>
        {log.rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing here"
            description="No messages in this state."
            className="py-8"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-2xs text-subtle text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">To</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {log.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      <p>{r.toName}</p>
                      <p className="text-2xs text-subtle">
                        {r.toAddress ?? "no address"} · {r.recipientKind}
                      </p>
                    </td>
                    <td className="max-w-xs truncate px-4 py-2">{r.subject}</td>
                    <td className="px-4 py-2 text-xs">{SOURCE[r.sourceType]}</td>
                    <td className="px-4 py-2">
                      <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                      {r.lastError && <p className="text-2xs text-subtle mt-0.5">{r.lastError}</p>}
                    </td>
                    <td className="text-2xs text-subtle px-4 py-2">
                      {r.sentAt
                        ? `Sent ${formatDateTime(r.sentAt.toISOString())}${r.transport ? ` · ${r.transport}` : ""}`
                        : r.status === "held"
                          ? `Leaves ${formatDateTime(r.notBefore.toISOString())}`
                          : `Created ${formatDateTime(r.createdAt.toISOString())}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WidgetCard>
    </>
  );
}
