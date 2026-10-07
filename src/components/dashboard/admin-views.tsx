import { KeyRound, MonitorSmartphone, ShieldAlert, Users, Wallet } from "lucide-react";
import { InsightCard } from "@/components/patterns/insight-card";
import { adminOverview } from "@/domains/admin/queries";
import { listInbox } from "@/domains/announcements/repository";
import { summarize } from "@/domains/students/query";
import { visibleStudents } from "@/domains/students/repository";
import { studentsHref } from "@/domains/students/params";
import type { Authed } from "@/lib/authz/context";
import { authorize } from "@/lib/authz/engine";
import { formatCompactINR, formatNumber } from "@/lib/utils";
import { DrillLink, NoticeList, WidgetCard } from "./widgets";

/** Super Admin workspace: the health of access control itself. */
export async function AdminDashboard({ authed }: { authed: Authed }) {
  const stats = await adminOverview(authed);
  const canAudit = authorize(authed.ctx, authed.tree, "audit:view", {
    kind: "tenant",
    tenantId: authed.ctx.tenantId,
  }).allowed;
  const notices = (await listInbox(authed, "mine")).slice(0, 4);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={Users}
          label="Members"
          value={formatNumber(stats.users)}
          context="Users who can sign in to this institution"
          definition="Tenant memberships, any status"
          href="/admin/access"
        />
        <InsightCard
          icon={KeyRound}
          label="Active role assignments"
          value={formatNumber(stats.assignments)}
          context="Unrevoked, across all scopes"
          definition="user_role_assignment rows without revoked_at"
          href="/admin/access"
        />
        <InsightCard
          icon={MonitorSmartphone}
          label="Live sessions"
          value={formatNumber(stats.sessions)}
          context="Unexpired sign-ins"
          definition="auth_session rows not yet expired"
          href="/admin/access"
        />
        <InsightCard
          icon={ShieldAlert}
          label="Denied attempts · 7 days"
          value={formatNumber(stats.denials)}
          context="Out-of-scope reads and refused changes"
          definition="Audit events with outcome = denied"
          tone={stats.denials > 0 ? "warning" : "success"}
          href={canAudit ? "/admin/audit?outcome=denied" : undefined}
        />
      </div>
      <WidgetCard title="Latest notices" action={<DrillLink href="/announcements">Inbox</DrillLink>} flush>
        <NoticeList items={notices} />
      </WidgetCard>
    </div>
  );
}

/** Specialised offices (exams, finance, placement): scoped student lookup until their modules arrive. */
export async function OperationsDashboard({ authed }: { authed: Authed }) {
  const rows = await visibleStudents(authed);
  const sum = summarize(rows);
  const notices = (await listInbox(authed, "mine")).slice(0, 4);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={Users}
          label="Students in scope"
          value={formatNumber(sum.total)}
          context={`${formatNumber(sum.active)} active`}
          definition="Students you may open"
          href={studentsHref({})}
        />
        {sum.financeCount > 0 && (
          <InsightCard
            icon={Wallet}
            label="Fees overdue"
            value={formatNumber(sum.feeOverdue)}
            context={`${formatCompactINR(sum.feeOutstanding)} outstanding across all dues`}
            definition="Balance past the semester due date"
            tone={sum.feeOverdue ? "warning" : "success"}
            href={studentsHref({ fee: "overdue" })}
          />
        )}
      </div>
      <WidgetCard
        title="Your module"
        description="Dedicated exam, finance and placement workspaces arrive in Phases 4, 7 and 8."
      >
        <p className="text-muted text-sm">
          Use the student directory for lookups. You only see the fields your office needs.
        </p>
      </WidgetCard>
      <WidgetCard title="Latest notices" action={<DrillLink href="/announcements">Inbox</DrillLink>} flush>
        <NoticeList items={notices} />
      </WidgetCard>
    </div>
  );
}
