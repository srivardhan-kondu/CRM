import { UserX } from "lucide-react";
import type { Metadata } from "next";
import { AdminDashboard, OperationsDashboard } from "@/components/dashboard/admin-views";
import { ScopeSelect } from "@/components/dashboard/scope-select";
import {
  AnnouncementsAndActivity,
  AttentionOnly,
  ClassInchargeDashboard,
  FacultyDashboard,
  LeadershipDashboard,
  StudentDashboard,
} from "@/components/dashboard/views";
import { ExamsDashboard } from "@/components/exams/dashboard";
import { EmptyState } from "@/components/os/empty-state";
import { academicContext } from "@/domains/academics/context";
import { linkedStudents } from "@/domains/students/repository";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { coversUnit } from "@/lib/authz/engine";
import { depthFirst } from "@/lib/authz/org-tree";
import { institutionNow } from "@/lib/clock";

export const metadata: Metadata = { title: "Home" };

const dateLabel = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(d);

function greeting(d: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(d),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await requireAuth();
  const { ctx, tree } = authed;
  // Pages render alongside the layout, so each must handle "no role" itself (the layout shows the message).
  const active = ctx.active;
  if (!active) return null;
  const workspace = workspaceFor(active.roleKey);
  const home = tree.byId.get(active.orgUnitId) ?? tree.root;
  const now = institutionNow();
  const firstName = ctx.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s+/, "").split(" ")[0];
  const linked =
    workspace === "self"
      ? await linkedStudents(authed, "self")
      : workspace === "guardian"
        ? await linkedStudents(authed, "guardian")
        : [];
  const context = await academicContext(ctx);

  // Leaders may look at any campus, school or department inside their own scope; anything else falls back to home.
  const leader = workspace === "leadership" || workspace === "department";
  const scopes = leader
    ? depthFirst(tree).filter(
        (n) =>
          (n.id === home.id || ["campus", "school", "department"].includes(n.type)) &&
          coversUnit(active, n, tree),
      )
    : [];
  const requested = (await searchParams).scope;
  const unit = (typeof requested === "string" && scopes.find((n) => n.code === requested)) || home;

  const title = {
    admin: `${greeting(now)}, ${firstName}`,
    leadership: `${greeting(now)}, ${firstName}`,
    department: `${greeting(now)}, ${firstName}`,
    class: `${greeting(now)}, ${firstName}`,
    teaching: `${greeting(now)}, ${firstName}`,
    self: `${greeting(now)}, ${firstName}`,
    guardian: linked[0] ? `${linked[0].student.name.split(" ")[0]}'s day` : "Your child's day",
    examinations: `${greeting(now)}, ${firstName}`,
    operations: `${greeting(now)}, ${firstName}`,
  }[workspace];
  const purpose = {
    admin: "Access control and platform health.",
    leadership: "Here is how the campus is doing, and what needs you today.",
    department: "Here is how your department is doing, and what needs you today.",
    class: `Here is how your class, ${home.name.replace(/^Section /, "")}, is doing today.`,
    teaching: "Here are your classes and what needs you today.",
    self: "Here is what needs your attention today.",
    guardian: "Here is how your child is doing.",
    examinations: "Here are the examinations and what needs you today.",
    operations: `${active.roleName} workspace.`,
  }[workspace];

  return (
    <div className="animate-page-in">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted text-[15px] font-medium">
            {dateLabel(now)} · {context.term}
          </p>
          <h1 className="text-foreground mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted mt-1 text-[17px]">{purpose}</p>
        </div>
        {scopes.length > 1 && (
          <ScopeSelect
            value={unit.code}
            options={scopes.map((n) => ({
              code: n.code,
              label: n.type === "institution" ? `${n.name} (whole institution)` : n.name,
            }))}
          />
        )}
      </header>

      {workspace === "admin" ? (
        <div className="space-y-6">
          <AttentionOnly authed={authed} workspace={workspace} unit={unit} />
          <AdminDashboard authed={authed} />
          <AnnouncementsAndActivity authed={authed} />
        </div>
      ) : leader ? (
        <LeadershipDashboard authed={authed} unit={unit} workspace={workspace} />
      ) : workspace === "class" ? (
        <ClassInchargeDashboard authed={authed} unit={home} />
      ) : workspace === "teaching" ? (
        <FacultyDashboard authed={authed} unit={home} />
      ) : workspace === "examinations" ? (
        <div className="space-y-6">
          <AttentionOnly authed={authed} workspace={workspace} unit={unit} />
          <ExamsDashboard authed={authed} />
          <AnnouncementsAndActivity authed={authed} />
        </div>
      ) : workspace === "self" || workspace === "guardian" ? (
        linked[0] ? (
          <StudentDashboard authed={authed} record={linked[0]} workspace={workspace} />
        ) : (
          <EmptyState
            icon={UserX}
            title="No linked student record"
            description="Your account isn't linked to a student record yet. Contact the administration office."
          />
        )
      ) : (
        <div className="space-y-6">
          <AttentionOnly authed={authed} workspace={workspace} unit={unit} />
          <OperationsDashboard authed={authed} />
        </div>
      )}
    </div>
  );
}
