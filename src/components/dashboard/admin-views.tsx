import { MetricCard } from "@/components/os/metrics";
import { AnnouncementList, Panel, PlannedCard } from "@/components/os/cards";
import { adminOverview } from "@/domains/admin/queries";
import { listInbox } from "@/domains/announcements/repository";
import { summarize } from "@/domains/students/query";
import { visibleStudents } from "@/domains/students/repository";
import { studentsHref } from "@/domains/students/params";
import type { Authed } from "@/lib/authz/context";
import { authorize } from "@/lib/authz/engine";
import { institutionNow } from "@/lib/clock";
import { formatNumber } from "@/lib/utils";

/** Super Admin workspace: the health of access control itself. */
export async function AdminDashboard({ authed }: { authed: Authed }) {
  const stats = await adminOverview(authed);
  const canAudit = authorize(authed.ctx, authed.tree, "audit:view", {
    kind: "tenant",
    tenantId: authed.ctx.tenantId,
  }).allowed;
  return (
    <section aria-label="Access control" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Members"
        value={formatNumber(stats.users)}
        context="Users who can sign in to this institution"
        definition="Tenant memberships, any status"
        href="/admin/access"
      />
      <MetricCard
        label="Active role assignments"
        value={formatNumber(stats.assignments)}
        context="Unrevoked, across all scopes"
        definition="Role assignments without a revocation"
        href="/admin/access"
      />
      <MetricCard
        label="Live sessions"
        value={formatNumber(stats.sessions)}
        context="Unexpired sign-ins"
        definition="Sessions not yet expired"
        href="/admin/access"
      />
      <MetricCard
        label="Denied attempts · 7 days"
        value={formatNumber(stats.denials)}
        context="Out-of-scope reads and refused changes"
        definition="Audit events with outcome = denied in the last 7 days"
        status={stats.denials > 0 ? "watch" : "good"}
        href={canAudit ? "/admin/audit?outcome=denied" : undefined}
      />
    </section>
  );
}

/** Specialised offices (finance, placement): scoped student lookup until their modules arrive. */
export async function OperationsDashboard({ authed }: { authed: Authed }) {
  const rows = await visibleStudents(authed);
  const sum = summarize(rows);
  const notices = (await listInbox(authed, "all")).slice(0, 4);
  const finance = authed.ctx.active?.roleKey === "finance_officer";
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <MetricCard
          label="Students in scope"
          value={formatNumber(sum.total)}
          context={`${formatNumber(sum.active)} active`}
          definition="Students you may open"
          href={studentsHref({})}
        />
        <PlannedCard
          title={finance ? "Fees and collections" : "Placements"}
          phase={finance ? 7 : 8}
          description={
            finance
              ? "Fee plans, invoices, dues and concessions. Until then, use the student directory for lookups — you only see the fields your office needs."
              : "Drives, eligibility rules, applications and offers. Until then, use the student directory for lookups."
          }
        />
      </div>
      <Panel title="Announcements" href="/announcements" hrefLabel="Inbox" flush>
        <AnnouncementList items={notices} now={institutionNow()} />
      </Panel>
    </div>
  );
}
