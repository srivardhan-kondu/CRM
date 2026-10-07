import { CheckCircle2, ScrollText, ShieldAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { listAuditEvents, type AuditRow } from "@/domains/admin/queries";
import { requireAuth } from "@/lib/authz/context";

export const metadata: Metadata = { title: "Audit log" };

const querySchema = z.object({
  action: z.string().trim().max(60).optional().catch(undefined),
  outcome: z.enum(["success", "denied", "failure"]).optional().catch(undefined),
  actor: z.string().trim().max(120).optional().catch(undefined),
  before: z.iso.datetime().optional().catch(undefined),
});

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Kolkata",
});

function Outcome({ outcome }: { outcome: AuditRow["outcome"] }) {
  if (outcome === "success")
    return (
      <Badge tone="success">
        <CheckCircle2 aria-hidden /> Success
      </Badge>
    );
  if (outcome === "denied")
    return (
      <Badge tone="danger">
        <ShieldAlert aria-hidden /> Denied
      </Badge>
    );
  return (
    <Badge tone="warning">
      <XCircle aria-hidden /> Failure
    </Badge>
  );
}

function details(e: AuditRow): string {
  const m = e.metadata ?? {};
  const parts = [
    typeof m.target === "string" ? `target ${m.target}` : null,
    typeof m.email === "string" ? m.email : null,
    typeof m.role === "string" ? `role ${m.role}` : null,
    typeof m.orgUnit === "string" ? `on ${m.orgUnit}` : null,
    typeof m.via === "string" ? `via ${m.via}` : null,
    e.reason,
  ].filter(Boolean);
  return parts.join(" · ");
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const authed = await requireAuth();
  const query = querySchema.parse(await searchParams);
  const events = await listAuditEvents(authed, query);

  if (events === null) {
    return (
      <div className="border-border bg-surface rounded-lg border py-12 shadow-xs">
        <PermissionState description="The audit trail is available to institution-wide administrators." />
      </div>
    );
  }

  const last = events.at(-1);
  const nextHref =
    events.length === 50 && last
      ? `/admin/audit?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter(([, v]) => v)), before: last.occurredAt.toISOString() })}`
      : null;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of sign-ins, sensitive record views, permission changes and denied attempts. Entries can't be edited or deleted — the database rejects it."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration" },
          { label: "Audit log" },
        ]}
      />
      <form className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input
          name="action"
          defaultValue={query.action}
          placeholder="Action prefix, e.g. role_assignment"
          aria-label="Action"
          className="sm:w-64"
        />
        <Input
          name="actor"
          defaultValue={query.actor}
          placeholder="Actor email"
          aria-label="Actor"
          className="sm:w-56"
        />
        <Select name="outcome" defaultValue={query.outcome ?? ""} aria-label="Outcome" className="sm:w-40">
          <option value="">Any outcome</option>
          <option value="success">Success</option>
          <option value="denied">Denied</option>
          <option value="failure">Failure</option>
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
        {(query.action || query.actor || query.outcome || query.before) && (
          <Button asChild variant="ghost">
            <Link href="/admin/audit">Clear</Link>
          </Button>
        )}
      </form>

      <div className="border-border bg-surface rounded-lg border shadow-xs">
        {events.length === 0 ? (
          <EmptyState icon={ScrollText} title="No matching events" description="Try widening the filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                  <th className="px-4 py-2 font-medium">Time (IST)</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Resource</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {events.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="text-muted tabular px-4 py-2 text-xs whitespace-nowrap">
                      {timeFmt.format(e.occurredAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {e.actorEmail ?? <span className="text-subtle">system</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-2">
                      <Outcome outcome={e.outcome} />
                    </td>
                    <td className="text-muted px-3 py-2 font-mono text-xs">
                      {e.resourceType ? `${e.resourceType}:${e.resourceId?.slice(0, 12) ?? ""}` : "—"}
                    </td>
                    <td className="text-muted max-w-md px-4 py-2 text-xs">{details(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextHref && (
          <div className="border-border border-t px-4 py-2 text-right">
            <Button asChild variant="ghost" size="sm">
              <Link href={nextHref}>Older events →</Link>
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
