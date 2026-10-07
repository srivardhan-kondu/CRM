import { UserX } from "lucide-react";
import type { Metadata } from "next";
import { AdminDashboard, OperationsDashboard } from "@/components/dashboard/admin-views";
import {
  ClassInchargeDashboard,
  FacultyDashboard,
  LeadershipDashboard,
  StudentDashboard,
} from "@/components/dashboard/views";
import { ExamsDashboard } from "@/components/exams/dashboard";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/states";
import { linkedStudents } from "@/domains/students/repository";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { describeAssignmentScope } from "@/lib/authz/describe";
import { academicContext } from "@/domains/academics/context";
import { DEMO_NOW } from "@/lib/demo/fixtures";

export const metadata: Metadata = { title: "Dashboard" };

const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(
  DEMO_NOW,
);

export default async function DashboardPage() {
  const authed = await requireAuth();
  const { ctx, tree } = authed;
  // Pages render alongside the layout, so each must handle "no role" itself (the layout shows the message).
  const active = ctx.active;
  if (!active) return null;
  const workspace = workspaceFor(active.roleKey);
  const unit = tree.byId.get(active.orgUnitId) ?? tree.root;
  const firstName = ctx.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s+/, "").split(" ")[0];
  const linked =
    workspace === "self"
      ? await linkedStudents(authed, "self")
      : workspace === "guardian"
        ? await linkedStudents(authed, "guardian")
        : [];
  const context = await academicContext(ctx);

  const heading = {
    admin: { title: `Welcome, ${firstName}`, description: `Access control health for ${ctx.tenantName}.` },
    leadership: {
      title: `Good morning, ${firstName}`,
      description: "Institution pulse — what's abnormal today and where to act.",
    },
    department: {
      title: `Good morning, ${firstName}`,
      description: "Department health across sections, with students that need attention.",
    },
    class: {
      title: `My class · ${unit.name.replace(/^Section /, "")}`,
      description: "Today's sessions, students to follow up, and class notices.",
    },
    teaching: {
      title: "My classes",
      description: "Today's teaching schedule and subject-level attendance for your courses.",
    },
    self: { title: `Hi, ${firstName}`, description: "Your attendance, progress and what needs your action." },
    guardian: {
      title: linked[0] ? `${linked[0].student.name.split(" ")[0]}'s progress` : "Your child's progress",
      description: "Attendance, academics, fees and notices for your linked student.",
    },
    examinations: {
      title: `Good morning, ${firstName}`,
      description: "Examinations in progress, results to publish and decisions waiting on the exam cell.",
    },
    operations: { title: `Welcome, ${firstName}`, description: `${active.roleName} workspace.` },
  }[workspace];

  return (
    <>
      <PageHeader
        title={heading.title}
        description={heading.description}
        actions={
          <p className="text-muted text-xs">
            {dateLabel} · {context.term} · {active.roleName}, {describeAssignmentScope(active, tree)}
          </p>
        }
      />
      {workspace === "admin" ? (
        <AdminDashboard authed={authed} />
      ) : workspace === "leadership" || workspace === "department" ? (
        <LeadershipDashboard authed={authed} unit={unit} />
      ) : workspace === "class" ? (
        <ClassInchargeDashboard authed={authed} unit={unit} />
      ) : workspace === "teaching" ? (
        <FacultyDashboard authed={authed} />
      ) : workspace === "examinations" ? (
        <ExamsDashboard authed={authed} />
      ) : workspace === "self" || workspace === "guardian" ? (
        linked[0] ? (
          <StudentDashboard authed={authed} record={linked[0]} />
        ) : (
          <EmptyState
            icon={UserX}
            title="No linked student record"
            description="Your account isn't linked to a student record yet. Contact the administration office."
          />
        )
      ) : (
        <OperationsDashboard authed={authed} />
      )}
    </>
  );
}
