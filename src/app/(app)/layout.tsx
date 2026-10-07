import { ShieldOff } from "lucide-react";
import { signOut } from "@/app/actions/session";
import { EmptyState } from "@/components/patterns/states";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ShellProvider } from "@/components/shell/shell-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar, type TopbarAlert, type TopbarNotice, type TopbarTask } from "@/components/shell/topbar";
import { Button } from "@/components/ui/button";
import { academicContext } from "@/domains/academics/context";
import { listInbox, pendingForApproval } from "@/domains/announcements/repository";
import { unreadGuardianMessages } from "@/domains/messages/repository";
import { myNotifications } from "@/domains/notifications/repository";
import { myOpenSessions, pendingApprovalsFor } from "@/domains/attendance/repository";
import { institutionNow } from "@/lib/clock";
import { linkedStudents } from "@/domains/students/repository";
import { workspaceFor } from "@/lib/authz/catalogue";
import { getMemberships, requireAuth } from "@/lib/authz/context";
import { describeAssignmentScope } from "@/lib/authz/describe";
import { authorize, holdsAnywhere } from "@/lib/authz/engine";
import { flattenNav, navigationFor } from "@/lib/navigation/nav";
import { formatRelative } from "@/lib/utils";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const authed = await requireAuth();
  const { ctx, tree } = authed;

  if (!ctx.active) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState
          icon={ShieldOff}
          title="No role assigned yet"
          description={`You're signed in as ${ctx.email} at ${ctx.tenantName}, but no role has been assigned to you. Ask your administrator to grant one.`}
          action={
            <form action={signOut}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          }
        />
      </main>
    );
  }

  const workspace = workspaceFor(ctx.active.roleKey);
  const linked =
    workspace === "self"
      ? await linkedStudents(authed, "self")
      : workspace === "guardian"
        ? await linkedStudents(authed, "guardian")
        : [];
  const groups = navigationFor(workspace, {
    linkedStudentId: linked[0]?.student.id,
    canManageAccess: holdsAnywhere(ctx, "role_assignment:manage") || holdsAnywhere(ctx, "user:manage"),
    canViewAudit: authorize(ctx, tree, "audit:view", { kind: "tenant", tenantId: ctx.tenantId }).allowed,
  });

  const now = institutionNow();
  const [today, context, personal, pendingNotices, unreadMessages] = await Promise.all([
    listInbox(authed, "today"),
    academicContext(ctx),
    myNotifications(ctx.tenantId, ctx.userId),
    pendingForApproval(authed),
    unreadGuardianMessages(authed),
  ]);
  const notices: TopbarNotice[] = today.slice(0, 5).map((a) => ({
    id: a.id,
    title: a.title,
    meta: `${a.authorRole} · ${formatRelative(a.publishedAt, now)}`,
    urgent: a.severity === "critical",
    unread: !a.read,
  }));
  const alerts: TopbarAlert[] = personal.items.map((n) => ({
    id: n.id,
    title: n.title,
    meta: `${n.body} · ${formatRelative(n.createdAt, now)}`,
    href: n.href,
    unread: !n.read,
  }));

  const [approvals, open] = await Promise.all([pendingApprovalsFor(authed), myOpenSessions(authed)]);
  const noticeTasks: TopbarTask[] = pendingNotices.map((a) => ({
    id: a.id,
    title: `Announcement: ${a.title}`,
    meta: `${a.author} · submitted ${a.submittedAt ? formatRelative(a.submittedAt, now) : ""}`,
    overdue: false,
  }));
  const tasks: TopbarTask[] | null =
    approvals || noticeTasks.length > 0
      ? [
          ...noticeTasks,
          ...(approvals ?? []).map((a) => ({
            id: a.id,
            title: a.title,
            meta: `${a.requester} · ${a.overdue ? "SLA breached" : `due ${formatRelative(a.dueAt, now)}`}`,
            overdue: a.overdue,
          })),
        ]
      : null;

  const memberships = await getMemberships(ctx.userId);
  const attention = today.filter((a) => !a.read || (a.requiresAck && !a.acknowledged)).length;
  const badges: Record<string, number> = {};
  if (attention) badges.announcements = attention;
  if (tasks?.length) badges.approvals = tasks.length;
  if (unreadMessages) badges["my-messages"] = unreadMessages;
  const toMark = (open?.markNow.length ?? 0) + (open?.overdue.length ?? 0);
  if (toMark) badges.tasks = toMark;

  return (
    <ShellProvider>
      <div className="flex min-h-dvh">
        <Sidebar groups={groups} badges={badges} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            user={{
              name: ctx.name,
              email: ctx.email,
              roleLabel: ctx.active.roleName,
              scopeLabel: describeAssignmentScope(ctx.active, tree),
            }}
            context={context}
            workspaces={ctx.assignments.map((a) => ({
              id: a.id,
              role: a.roleName,
              scope: describeAssignmentScope(a, tree),
              active: a.id === ctx.active?.id,
            }))}
            tenants={memberships.map((m) => ({
              id: m.tenantId,
              name: m.name,
              active: m.tenantId === ctx.tenantId,
            }))}
            notices={notices}
            alerts={alerts}
            unreadAlerts={personal.unread}
            tasks={tasks}
          />
          <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-6">
            {children}
          </main>
        </div>
      </div>
      <MobileNav groups={groups} badges={badges} />
      <CommandPalette
        nav={flattenNav(groups)}
        canSearchStudents={workspace !== "self" && workspace !== "guardian"}
      />
    </ShellProvider>
  );
}
