import {
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  Inbox,
  ListChecks,
  MessageSquareText,
  PenSquare,
  Sparkles,
  UserRoundSearch,
} from "lucide-react";
import Link from "next/link";
import { ActionRequired, AttentionCard, WorkQueue, type WorkItem } from "@/components/os/attention";
import {
  ActivityList,
  AnnouncementList,
  Panel,
  PlannedCard,
  QuickAction,
  StudentRiskCard,
} from "@/components/os/cards";
import { CampusPulse, MetricCard, TrendCard } from "@/components/os/metrics";
import { Meter } from "@/components/ui/misc";
import { getCurrentTerm } from "@/domains/academics/context";
import { listFaculty } from "@/domains/academics/repository";
import { listInbox } from "@/domains/announcements/repository";
import { weekdayName } from "@/domains/attendance/calendar";
import { projectAttendance } from "@/domains/attendance/projection";
import { classesOn } from "@/domains/attendance/repository";
import { assessmentWorkspace, studentExams } from "@/domains/exams/repository";
import type { AttentionItem } from "@/domains/insights/attention";
import {
  attentionFor,
  pulseFor,
  recentActivity,
  scopeSnapshot,
  type TrendPoint,
} from "@/domains/insights/repository";
import { studentsHref } from "@/domains/students/params";
import { groupBy, type Visible } from "@/domains/students/query";
import { subjectsFor, visibleStudents } from "@/domains/students/repository";
import type { Student } from "@/domains/students/types";
import type { WorkspaceKind } from "@/lib/authz/catalogue";
import type { Authed } from "@/lib/authz/context";
import { holdsAnywhere } from "@/lib/authz/engine";
import { descendantsOfType, isWithin } from "@/lib/authz/org-tree";
import type { OrgNode } from "@/lib/authz/types";
import { institutionNow, institutionToday } from "@/lib/clock";
import { cn, formatDate, pluralize, sectionLabel } from "@/lib/utils";
import { ScheduleList, ThresholdBars, type BarRow } from "./widgets";

/*
 * Role dashboards. Each follows the same order: what needs attention (critical first), what to do, how things are
 * trending, role-specific detail, then announcements and recent activity. Modules from later phases appear as plainly
 * labelled placeholders, never as invented numbers.
 */

const trendPoints = (points: TrendPoint[]) =>
  points.map((p) => ({
    label: new Date(`${p.week}T00:00:00+05:30`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    }),
    value: p.value,
  }));

const TREND_DEFINITION =
  "Present marks ÷ marks recorded per week, before on-duty and medical leave adjustments.";

const riskOrder = (a: Student, b: Student) => {
  const rank = { high: 0, watch: 1, none: 2 } as const;
  return rank[a.risk.level] - rank[b.risk.level] || a.attendancePct - b.attendancePct;
};

function Grid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-5", className)}>{children}</div>;
}

async function notices(authed: Authed, n = 4) {
  return (await listInbox(authed, "all")).slice(0, n);
}

/** Attention block (critical and important) beside quick actions, then the action tiles. */
function AttentionBlock({ items, quick }: { items: AttentionItem[]; quick: React.ReactNode }) {
  const attention = items.filter((i) => i.priority === "critical" || i.priority === "important");
  return (
    <>
      <Grid className="xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <AttentionCard items={attention} />
        <section aria-label="Quick actions" className="space-y-2">
          <h2 className="text-muted text-xs font-semibold tracking-wide uppercase">Quick actions</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">{quick}</div>
        </section>
      </Grid>
      <ActionRequired items={items} />
    </>
  );
}

/** Attendance per campus, department or section, worst first. */
function comparison(
  authed: Authed,
  unit: OrgNode,
  rows: Visible[],
  by: "campus" | "department" | "section",
): BarRow[] {
  const avg = (list: Visible[]) =>
    list.reduce((n, r) => n + r.student.attendancePct, 0) / Math.max(1, list.length);
  const short = (list: Visible[]) =>
    list.filter((r) => r.student.attendancePct < r.student.attendanceThreshold).length;
  if (by === "section")
    return [...groupBy(rows, (r) => r.student.sectionId)]
      .map(([code, list]) => ({
        key: code,
        label: sectionLabel(code),
        sublabel: `${list.length} students`,
        value: avg(list),
        href: `/attendance/sections/${code}`,
        flag: short(list) ? `${short(list)} short` : undefined,
      }))
      .sort((a, b) => a.value - b.value);
  return descendantsOfType(authed.tree, unit, by)
    .map((node) => {
      const list = rows.filter((r) => {
        const sec = authed.tree.byCode.get(r.student.sectionId);
        return sec ? isWithin(sec, node) : false;
      });
      return {
        key: node.code,
        label: node.name,
        sublabel: pluralize(list.length, "student"),
        value: avg(list),
        href:
          by === "department"
            ? studentsHref({ department: node.code, sort: "attendance" })
            : `/dashboard?scope=${node.code}`,
        flag: short(list) ? `${short(list)} short` : undefined,
        count: list.length,
      };
    })
    .filter((b) => b.count > 0)
    .sort((a, b) => a.value - b.value);
}

/* ---------- Leadership: Principal, Director, Dean, HOD, coordinators ---------- */

export async function LeadershipDashboard({
  authed,
  unit,
  workspace,
}: {
  authed: Authed;
  unit: OrgNode;
  workspace: WorkspaceKind;
}) {
  const director = authed.ctx.active?.roleKey === "director";
  const [pulse, attention, snap, inbox, activity] = await Promise.all([
    pulseFor(authed, unit),
    attentionFor(authed, workspace, unit),
    scopeSnapshot(authed, unit),
    notices(authed),
    recentActivity(authed),
  ]);
  const now = institutionNow();
  const department = unit.type === "department";
  const by = department ? "section" : director && unit.type === "institution" ? "campus" : "department";
  const bars = comparison(authed, unit, snap.readable, by);
  const base = department ? { department: unit.code } : {};
  const risk = snap.highRisk
    .map((r) => r.student)
    .sort(riskOrder)
    .slice(0, 5);
  const canPublish = holdsAnywhere(authed.ctx, "announcement:publish");

  const quick = (
    <>
      <QuickAction href="/insights" icon={Sparkles} label="Ask CampusOS" hint="Questions about your scope" />
      <QuickAction href="/approvals" icon={ListChecks} label="Approvals" hint="Decide what's waiting" />
      {canPublish && <QuickAction href="/announcements/new" icon={PenSquare} label="New announcement" />}
      <QuickAction
        href={studentsHref({ ...base, shortage: true, sort: "attendance" })}
        icon={UserRoundSearch}
        label="Students below threshold"
        hint={pluralize(snap.shortage.length, "student")}
      />
    </>
  );

  return (
    <div className="space-y-6">
      <CampusPulse pulse={pulse} title={department ? "Department health" : "Campus health"} />
      <AttentionBlock items={attention} quick={quick} />

      <Grid className="xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <TrendCard
          title="Attendance, week by week"
          points={trendPoints(snap.trend)}
          threshold={snap.threshold}
          definition={TREND_DEFINITION}
          href="/attendance"
        />
        <Panel
          title={
            by === "campus"
              ? "Campus comparison"
              : by === "department"
                ? "Department performance"
                : "Sections"
          }
          description={`Average attendance, lowest first · line marks the ${snap.threshold}% requirement`}
          href="/attendance"
          hrefLabel="Attendance"
        >
          <ThresholdBars rows={bars} threshold={snap.threshold} />
        </Panel>
      </Grid>

      <Grid className="xl:grid-cols-2">
        <Panel
          title="Students needing intervention"
          description="High risk, with the factors behind each flag"
          href={studentsHref({ ...base, risk: "high", sort: "attendance" })}
          hrefLabel={`All ${snap.highRisk.length}`}
          flush
        >
          <StudentRiskCard students={risk} empty="No student crosses the high-risk definition." />
        </Panel>
        {department ? (
          <DepartmentOperations authed={authed} unit={unit} />
        ) : (
          <AcademicPerformance authed={authed} unit={unit} rows={snap.readable} />
        )}
      </Grid>

      {director && unit.type === "institution" && <Enrollment rows={snap.rows} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {department ? (
          <>
            <PlannedCard
              title="Mentoring"
              phase={6}
              description="Mentor allocation, meetings and interventions for the department's students."
            />
            <PlannedCard
              title="Placements"
              phase={8}
              description="Drives, eligibility and offers for the department's final years."
            />
            <PlannedCard
              title="Reports"
              phase={9}
              description="Saved department reports and permission-checked exports."
            />
          </>
        ) : (
          <>
            <PlannedCard
              title={director ? "Financial overview" : "Finance"}
              phase={7}
              description="Fee collection, dues and concessions. Fee figures shown elsewhere are synthetic until then."
            />
            <PlannedCard
              title={director ? "Placement performance" : "Placements"}
              phase={8}
              description="Drives, offers and placement rate by programme."
            />
            <PlannedCard
              title="Accreditation"
              phase={9}
              description="NAAC/NBA evidence with owners and freshness."
            />
          </>
        )}
      </div>

      <Grid className="xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="Announcements"
          description="Active notices in your scope"
          href="/announcements"
          hrefLabel="Inbox"
          flush
        >
          <AnnouncementList items={inbox} now={now} />
        </Panel>
        <Panel title="Recent activity" flush>
          <ActivityList items={activity} now={now} />
        </Panel>
      </Grid>
    </div>
  );
}

function AcademicPerformance({ authed, unit, rows }: { authed: Authed; unit: OrgNode; rows: Visible[] }) {
  const depts = descendantsOfType(authed.tree, unit, "department")
    .map((d) => {
      const list = rows.filter((r) => r.student.departmentCode === d.code);
      const graded = list.filter((r) => r.student.cgpa > 0);
      return {
        code: d.code,
        name: d.name,
        students: list.length,
        cgpa: graded.length ? graded.reduce((n, r) => n + r.student.cgpa, 0) / graded.length : 0,
        backlogs: list.filter((r) => r.student.backlogs > 0).length,
      };
    })
    .filter((d) => d.students > 0)
    .sort((a, b) => a.cgpa - b.cgpa);
  return (
    <Panel
      title="Academic performance"
      description="Mean CGPA and students with backlogs, by department"
      flush
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-subtle border-border border-b text-left text-xs">
            <th className="px-5 py-2 font-medium">Department</th>
            <th className="px-3 py-2 text-right font-medium">CGPA</th>
            <th className="px-5 py-2 text-right font-medium">With backlogs</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {depts.map((d) => (
            <tr key={d.code}>
              <td className="px-5 py-2">
                <Link href={studentsHref({ department: d.code, sort: "cgpa" })} className="hover:text-brand">
                  {d.name}
                </Link>
              </td>
              <td className="tabular px-3 py-2 text-right font-medium">{d.cgpa ? d.cgpa.toFixed(2) : "—"}</td>
              <td className="tabular text-muted px-5 py-2 text-right">
                {d.backlogs} of {d.students}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** Faculty workload and internal-assessment progress for a department. */
async function DepartmentOperations({ authed, unit }: { authed: Authed; unit: OrgNode }) {
  const term = await getCurrentTerm(authed.ctx.tenantId);
  const [faculty, marks] = await Promise.all([
    listFaculty(authed, term?.id ?? null),
    assessmentWorkspace(authed),
  ]);
  const mine = (faculty ?? [])
    .filter((f) => f.departmentCode === unit.code)
    .sort((a, b) => b.hours / b.maxWeeklyHours - a.hours / a.maxWeeklyHours);
  const components = (marks?.progress ?? []).flatMap((p) => p.components);
  const approved = components.filter((c) => c.status === "approved").length;
  return (
    <Panel
      title="Faculty workload"
      description={`Weekly hours against each member's cap · internal marks ${approved}/${components.length} approved`}
      href="/faculty"
      flush
    >
      <ul className="divide-border divide-y">
        {mine.slice(0, 6).map((f) => {
          const load = (f.hours / f.maxWeeklyHours) * 100;
          return (
            <li key={f.userId} className="px-5 py-2.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <Link href={`/faculty/${f.userId}`} className="hover:text-brand truncate">
                  {f.name}
                </Link>
                <span className="tabular text-muted shrink-0 text-xs">
                  {f.hours}/{f.maxWeeklyHours} h
                </span>
              </div>
              <Meter
                value={load}
                tone={load > 100 ? "danger" : load > 90 ? "warning" : "brand"}
                label={`${f.name} load ${load.toFixed(0)}%`}
                className="mt-1"
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Enrollment({ rows }: { rows: Visible[] }) {
  const batches = [...groupBy(rows, (r) => r.student.batch)].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...batches.map(([, l]) => l.length));
  return (
    <Panel title="Enrollment by batch" description="Enrolled students by admission batch">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {batches.map(([batch, list]) => (
          <li key={batch}>
            <div className="flex justify-between text-xs">
              <span className="text-muted">{batch}</span>
              <span className="tabular font-medium">{list.length}</span>
            </div>
            <Meter
              value={(list.length / max) * 100}
              label={`Batch ${batch}: ${list.length} students`}
              className="mt-1"
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------- Class incharge ---------- */

export async function ClassInchargeDashboard({ authed, unit }: { authed: Authed; unit: OrgNode }) {
  const sectionId = unit.code;
  const [pulse, attention, snap, today, inbox, activity] = await Promise.all([
    pulseFor(authed, unit),
    attentionFor(authed, "class", unit),
    scopeSnapshot(authed, unit),
    classesOn(authed, { sectionCode: sectionId }),
    notices(authed, 3),
    recentActivity(authed),
  ]);
  const now = institutionNow();
  const followUp = snap.rows
    .filter((r) => r.access.risk && r.student.risk.level !== "none")
    .map((r) => r.student)
    .sort(riskOrder)
    .slice(0, 6);
  const quick = (
    <>
      <QuickAction href="/attendance" icon={CalendarCheck} label="Mark attendance" hint="Today's classes" />
      <QuickAction href="/parent-communication" icon={MessageSquareText} label="Message guardians" />
      <QuickAction href={`/attendance/sections/${sectionId}`} icon={BookOpen} label="Class register" />
      <QuickAction href="/announcements/new" icon={PenSquare} label="Notice to the class" />
    </>
  );
  return (
    <div className="space-y-6">
      <CampusPulse pulse={pulse} title="Class health" />
      <AttentionBlock items={attention} quick={quick} />
      <Grid className="xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel
          title="Today's timetable"
          description={today ? `${weekdayName(today.date)} · ${unit.name}` : unit.name}
          href={`/attendance/sections/${sectionId}`}
          hrefLabel="Register"
          flush
        >
          <ScheduleList
            classes={today?.classes ?? []}
            now={institutionToday().time}
            emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
          />
        </Panel>
        <TrendCard
          title="Class attendance, week by week"
          points={trendPoints(snap.trend)}
          threshold={snap.threshold}
          definition={TREND_DEFINITION}
        />
      </Grid>
      <Grid className="xl:grid-cols-2">
        <Panel
          title="Students to follow up"
          description="Any risk factor, most urgent first"
          href={studentsHref({ sectionId, sort: "attendance" })}
          hrefLabel="Class list"
          flush
        >
          <StudentRiskCard students={followUp} empty="Everyone in your class is on track." />
        </Panel>
        <div className="space-y-3">
          <PlannedCard
            title="Mentoring"
            phase={6}
            description="Mentor meetings, agreed actions and interventions for your class."
          />
          <Panel title="Announcements" href="/announcements" hrefLabel="Inbox" flush>
            <AnnouncementList items={inbox} now={now} />
          </Panel>
        </div>
      </Grid>
      <Panel title="Recent activity" flush>
        <ActivityList items={activity} now={now} />
      </Panel>
    </div>
  );
}

/* ---------- Faculty ---------- */

/** Aggregates every teaching assignment the user holds, whichever one is the active workspace. */
export async function FacultyDashboard({ authed, unit }: { authed: Authed; unit: OrgNode }) {
  const teaching = authed.ctx.assignments.filter((a) => a.roleKey === "faculty");
  const sectionIds = [
    ...new Set(teaching.map((a) => authed.tree.byId.get(a.orgUnitId)?.code).filter((c): c is string => !!c)),
  ];
  const courseCodes = [...new Set(teaching.flatMap((a) => a.courseCodes ?? []))];
  const [attention, today, inbox] = await Promise.all([
    attentionFor(authed, "teaching", unit),
    classesOn(authed, { mine: true }),
    notices(authed, 3),
  ]);
  const now = institutionNow();
  const rows = (await visibleStudents(authed)).filter((v) => sectionIds.includes(v.student.sectionId));
  const courseRows = (
    await Promise.all(
      rows.map(async (v) =>
        (await subjectsFor(authed, v))
          .filter((x) => courseCodes.includes(x.courseCode))
          .map((subj) => ({
            student: v.student,
            subj,
            ...projectAttendance(subj.attended, subj.held, v.student.attendanceThreshold),
          })),
      ),
    )
  ).flat();
  const below = courseRows.filter((r) => r.pct < r.student.attendanceThreshold).sort((a, b) => a.pct - b.pct);
  const avg = courseRows.reduce((n, r) => n + r.pct, 0) / Math.max(1, courseRows.length);
  const schedule = today?.classes ?? [];
  const toMark = schedule.filter((c) => c.window === "open" && c.canMark && !c.recorded).length;
  const quick = (
    <>
      <QuickAction
        href="/attendance"
        icon={CalendarCheck}
        label="Mark attendance"
        hint={toMark ? `${toMark} ready now` : "Today's classes"}
      />
      <QuickAction href="/marks" icon={ClipboardCheck} label="Enter marks" hint="Internal assessment" />
      <QuickAction
        href="/my/courses"
        icon={BookOpen}
        label="My courses"
        hint={courseCodes.join(", ") || "No courses this term"}
      />
      <QuickAction href="/tasks" icon={ListChecks} label="Tasks" />
    </>
  );
  return (
    <div className="space-y-6">
      <AttentionBlock items={attention} quick={quick} />
      <Grid className="xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title="Today's classes"
          description="Mark attendance once a class starts, on the same day"
          href="/tasks"
          hrefLabel="Tasks"
          flush
        >
          <ScheduleList
            classes={schedule}
            now={institutionToday().time}
            showSection
            emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
          />
        </Panel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <MetricCard
            label="Attendance in your courses"
            value={courseRows.length ? `${avg.toFixed(1)}%` : "—"}
            context={`${pluralize(rows.length, "student")} across ${pluralize(sectionIds.length, "section")}`}
            definition="Mean subject attendance of your students in the courses you teach"
            href="/my/courses"
          />
          <MetricCard
            label="Below the requirement"
            value={below.length}
            context="In at least one of your courses"
            definition="Students under their programme threshold in a course you teach"
            status={below.length ? "watch" : "good"}
            href="/my/courses"
          />
        </div>
      </Grid>
      <Grid className="xl:grid-cols-2">
        <Panel
          title="Shortage in your courses"
          description="Classes each student must attend consecutively to recover"
          flush
        >
          {below.length === 0 ? (
            <p className="text-muted px-5 py-8 text-center text-sm">
              No student is below the requirement in your courses.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {below.slice(0, 6).map((r) => (
                <li
                  key={`${r.student.id}-${r.subj.courseCode}`}
                  className="flex items-center gap-3 px-5 py-2.5"
                >
                  <Link href={`/students/${r.student.id}`} className="hover:text-brand min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.student.name}</p>
                    <p className="text-subtle text-xs">
                      {r.subj.courseCode} · {r.student.sectionLabel} · {r.subj.attended}/{r.subj.held}{" "}
                      attended
                    </p>
                  </Link>
                  <span className="text-danger tabular text-sm font-medium">{r.pct.toFixed(0)}%</span>
                  <span className="text-muted w-24 text-right text-xs">attend next {r.mustAttend}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-3">
          <PlannedCard
            title="Assignments"
            phase={11}
            description="Coursework and submissions, through the LMS integration."
          />
          <Panel title="Announcements" href="/announcements" hrefLabel="Inbox" flush>
            <AnnouncementList items={inbox} now={now} />
          </Panel>
        </div>
      </Grid>
    </div>
  );
}

/* ---------- Student and guardian: My Day ---------- */

export async function StudentDashboard({
  authed,
  record,
  workspace,
}: {
  authed: Authed;
  record: Visible;
  workspace: WorkspaceKind;
}) {
  const { student: me } = record;
  const threshold = me.attendanceThreshold;
  const unit = authed.tree.byCode.get(me.sectionId) ?? authed.tree.root;
  const [attention, subjects, today, inbox, exams] = await Promise.all([
    attentionFor(authed, workspace, unit, record),
    subjectsFor(authed, record),
    classesOn(authed, { sectionCode: me.sectionId }),
    notices(authed, 4),
    studentExams(authed, record),
  ]);
  const now = institutionNow();
  const projected = subjects.map((s) => ({ ...s, ...projectAttendance(s.attended, s.held, threshold) }));
  const nowDate = now.toISOString().slice(0, 10);
  const papers: WorkItem[] = (exams?.sittings ?? [])
    .flatMap((s) => s.papers.map((p) => ({ ...p, event: s.event })))
    .filter((p) => p.slot && p.slot.date >= nowDate)
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      title: `${p.courseCode} ${p.courseName}`,
      meta: p.event.name,
      href: "/my/exams",
      state: { label: `${formatDate(p.slot!.date)} · ${p.slot!.session}`, tone: "neutral" },
    }));
  const guardian = workspace === "guardian";
  const quick = (
    <>
      <QuickAction
        href="/my/attendance"
        icon={CalendarCheck}
        label="Attendance"
        hint={`${me.attendancePct.toFixed(1)}% overall`}
      />
      <QuickAction
        href="/my/exams"
        icon={ClipboardCheck}
        label="Exams"
        hint={exams?.maySit === false ? "Eligibility at risk" : "Timetable and eligibility"}
      />
      <QuickAction href="/announcements?view=important" icon={Inbox} label="Inbox" />
      {guardian ? (
        <QuickAction href="/my/messages" icon={MessageSquareText} label="Messages" hint="From the college" />
      ) : (
        <QuickAction
          href="/my/academics"
          icon={BookOpen}
          label="Results"
          hint={me.cgpa ? `CGPA ${me.cgpa.toFixed(2)}` : "Semester results"}
        />
      )}
    </>
  );
  return (
    <div className="space-y-6">
      <AttentionBlock items={attention} quick={quick} />
      <Grid className="xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel
          title={guardian ? "Today's classes" : "My day"}
          description={today ? `${weekdayName(today.date)} · ${me.sectionLabel}` : me.sectionLabel}
          flush
        >
          <ScheduleList
            classes={today?.classes ?? []}
            now={institutionToday().time}
            emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
          />
        </Panel>
        <Panel
          title="Attendance by subject"
          description={`Against the ${threshold}% requirement`}
          href="/my/attendance"
          hrefLabel="Details & leave"
          flush
        >
          <ul className="divide-border divide-y">
            {projected.map((s) => {
              const short = s.pct < threshold;
              return (
                <li key={s.courseCode} className="px-5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm">
                      {s.courseName} <span className="text-subtle font-mono text-xs">{s.courseCode}</span>
                    </p>
                    <span className={cn("tabular text-sm font-semibold", short && "text-danger")}>
                      {s.pct.toFixed(1)}%
                    </span>
                  </div>
                  <Meter
                    value={s.pct}
                    tone={short ? "danger" : s.canMiss <= 2 ? "warning" : "brand"}
                    label={`${s.courseName} attendance`}
                    className="mt-1"
                  />
                  <p className={cn("mt-0.5 text-xs", short ? "text-danger" : "text-subtle")}>
                    {short
                      ? `Attend the next ${s.mustAttend} classes to reach ${threshold}%`
                      : s.canMiss === 0
                        ? "Can't miss the next class"
                        : `Can miss up to ${s.canMiss} more`}
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>
      </Grid>
      <Grid className="xl:grid-cols-2">
        <WorkQueue
          title="Upcoming exams"
          items={papers}
          href="/my/exams"
          empty={{
            title: "No upcoming papers",
            description: "Your exam timetable appears here once it's published.",
          }}
        />
        <Panel title="Announcements" href="/announcements" hrefLabel="Inbox" flush>
          <AnnouncementList items={inbox} now={now} />
        </Panel>
      </Grid>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PlannedCard
          title="Assignments"
          phase={11}
          description="Coursework and submissions, through the LMS integration."
        />
        <PlannedCard title="Fees" phase={7} description="Invoices, dues, receipts and online payment." />
        <PlannedCard
          title="Placements"
          phase={8}
          description="Drives you're eligible for, applications and offers."
        />
      </div>
    </div>
  );
}

/* ---------- Shared blocks for other workspaces ---------- */

/** Attention and actions for workspaces whose own detail is rendered separately (exam cell, admin, offices). */
export async function AttentionOnly({
  authed,
  workspace,
  unit,
}: {
  authed: Authed;
  workspace: WorkspaceKind;
  unit: OrgNode;
}) {
  const attention = await attentionFor(authed, workspace, unit);
  const quick = (
    <>
      <QuickAction href="/insights" icon={Sparkles} label="Ask CampusOS" />
      <QuickAction href="/announcements" icon={Inbox} label="Inbox" />
      {holdsAnywhere(authed.ctx, "announcement:publish") && (
        <QuickAction href="/announcements/new" icon={PenSquare} label="New announcement" />
      )}
    </>
  );
  return <AttentionBlock items={attention} quick={quick} />;
}

export async function AnnouncementsAndActivity({ authed }: { authed: Authed }) {
  const [inbox, activity] = await Promise.all([notices(authed), recentActivity(authed)]);
  const now = institutionNow();
  return (
    <Grid className="xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title="Announcements" href="/announcements" hrefLabel="Inbox" flush>
        <AnnouncementList items={inbox} now={now} />
      </Panel>
      <Panel title="Recent activity" flush>
        <ActivityList items={activity} now={now} />
      </Panel>
    </Grid>
  );
}
