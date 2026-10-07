import Link from "next/link";
import { ActivityList, AnnouncementList, Panel, StudentRiskCard } from "@/components/os/cards";
import { TrendCard } from "@/components/os/metrics";
import { Glance, HealthBanner, MoreDetails, Section, TodoList } from "@/components/os/simple";
import { Meter } from "@/components/ui/misc";
import { getCurrentTerm } from "@/domains/academics/context";
import { listFaculty } from "@/domains/academics/repository";
import { listInbox } from "@/domains/announcements/repository";
import { weekdayName } from "@/domains/attendance/calendar";
import { projectAttendance } from "@/domains/attendance/projection";
import { classesOn } from "@/domains/attendance/repository";
import { assessmentWorkspace, studentExams } from "@/domains/exams/repository";
import type { Pulse } from "@/domains/insights/attention";
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
import { descendantsOfType, isWithin } from "@/lib/authz/org-tree";
import type { OrgNode } from "@/lib/authz/types";
import { institutionNow, institutionToday } from "@/lib/clock";
import { cn, formatDate, pluralize, sectionLabel } from "@/lib/utils";
import { ScheduleList, ThresholdBars, type BarRow } from "./widgets";

/*
 * Role home pages, kept deliberately simple (the app is used by people of every age and comfort with computers):
 * one sentence on how things are, a short to-do list with one big button per item, a few large numbers, today's
 * classes and the latest notices. Charts, comparisons and full lists sit behind "Show more details".
 */

const trendPoints = (points: TrendPoint[]) =>
  points.map((p) => ({
    label: new Date(`${p.week}T00:00:00+05:30`).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    }),
    value: p.value,
  }));

const TREND_DEFINITION = "Share of students marked present each week (before leave is counted).";

const riskOrder = (a: Student, b: Student) => {
  const rank = { high: 0, watch: 1, none: 2 } as const;
  return rank[a.risk.level] - rank[b.risk.level] || a.attendancePct - b.attendancePct;
};

function Grid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-5", className)}>{children}</div>;
}

async function notices(authed: Authed, n = 3) {
  return (await listInbox(authed, "all")).slice(0, n);
}

function glanceFrom(pulse: Pulse, links: Record<string, string>) {
  return pulse.vitals.map((v) => ({ ...v, href: links[v.key] }));
}

function NoticesSection({ items, now }: { items: Awaited<ReturnType<typeof notices>>; now: Date }) {
  return (
    <Section title="Latest notices" href="/announcements" linkLabel="All notices">
      <AnnouncementList items={items} now={now} />
    </Section>
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
        flag: short(list) ? `${short(list)} below` : undefined,
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
        flag: short(list) ? `${short(list)} below` : undefined,
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
  const [pulse, todo, snap, inbox, activity] = await Promise.all([
    pulseFor(authed, unit),
    attentionFor(authed, workspace, unit),
    scopeSnapshot(authed, unit),
    notices(authed),
    recentActivity(authed),
  ]);
  const now = institutionNow();
  const department = unit.type === "department";
  const by = department ? "section" : director && unit.type === "institution" ? "campus" : "department";
  const base = department ? { department: unit.code } : {};
  const risk = snap.highRisk
    .map((r) => r.student)
    .sort(riskOrder)
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <HealthBanner pulse={pulse} />
      <TodoList items={todo} />
      <Glance
        items={glanceFrom(pulse, {
          attendance: "/attendance",
          eligibility: studentsHref({ ...base, shortage: true, sort: "attendance" }),
          risk: studentsHref({ ...base, risk: "high", sort: "attendance" }),
          operations: "/approvals",
        })}
      />
      <NoticesSection items={inbox} now={now} />

      <MoreDetails>
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
                ? "Attendance by campus"
                : by === "department"
                  ? "Attendance by department"
                  : "Attendance by section"
            }
            description={`Lowest first · the line marks ${snap.threshold}%`}
            href="/attendance"
            hrefLabel="Attendance"
          >
            <ThresholdBars rows={comparison(authed, unit, snap.readable, by)} threshold={snap.threshold} />
          </Panel>
        </Grid>
        <Grid className="xl:grid-cols-2">
          <Panel
            title="Students who need extra help"
            description="And why, for each student"
            href={studentsHref({ ...base, risk: "high", sort: "attendance" })}
            hrefLabel={`All ${snap.highRisk.length}`}
            flush
          >
            <StudentRiskCard students={risk} empty="No student needs extra help right now." />
          </Panel>
          {department ? (
            <DepartmentOperations authed={authed} unit={unit} />
          ) : (
            <AcademicPerformance authed={authed} unit={unit} rows={snap.readable} />
          )}
        </Grid>
        {director && unit.type === "institution" && <Enrollment rows={snap.rows} />}
        <Panel title="What happened recently" flush>
          <ActivityList items={activity} now={now} />
        </Panel>
      </MoreDetails>
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
    <Panel title="Marks by department" description="Average CGPA, and students with failed subjects" flush>
      <table className="w-full text-[15px]">
        <thead>
          <tr className="text-muted border-border border-b text-left text-sm">
            <th className="px-5 py-2 font-medium">Department</th>
            <th className="px-3 py-2 text-right font-medium">CGPA</th>
            <th className="px-5 py-2 text-right font-medium">With failed subjects</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {depts.map((d) => (
            <tr key={d.code}>
              <td className="px-5 py-2.5">
                <Link href={studentsHref({ department: d.code, sort: "cgpa" })} className="hover:text-brand">
                  {d.name}
                </Link>
              </td>
              <td className="tabular px-3 py-2.5 text-right font-semibold">
                {d.cgpa ? d.cgpa.toFixed(2) : "—"}
              </td>
              <td className="tabular text-muted px-5 py-2.5 text-right">
                {d.backlogs} of {d.students}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** Faculty workload and internal-marks progress for a department. */
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
      title="Teaching hours"
      description={`Hours per week against each teacher's limit · ${approved} of ${components.length} mark sheets approved`}
      href="/faculty"
      flush
    >
      <ul className="divide-border divide-y">
        {mine.slice(0, 6).map((f) => {
          const load = (f.hours / f.maxWeeklyHours) * 100;
          return (
            <li key={f.userId} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3 text-[15px]">
                <Link href={`/faculty/${f.userId}`} className="hover:text-brand truncate">
                  {f.name}
                </Link>
                <span className="tabular text-muted shrink-0 text-sm">
                  {f.hours} of {f.maxWeeklyHours} hours
                </span>
              </div>
              <Meter
                value={load}
                tone={load > 100 ? "danger" : load > 90 ? "warning" : "brand"}
                label={`${f.name}: ${load.toFixed(0)}% of their limit`}
                className="mt-1.5"
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
    <Panel title="Students by year of joining">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {batches.map(([batch, list]) => (
          <li key={batch}>
            <div className="flex justify-between text-sm">
              <span className="text-muted">{batch}</span>
              <span className="tabular font-semibold">{list.length}</span>
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
  const [pulse, todo, snap, today, inbox] = await Promise.all([
    pulseFor(authed, unit),
    attentionFor(authed, "class", unit),
    scopeSnapshot(authed, unit),
    classesOn(authed, { sectionCode: sectionId }),
    notices(authed),
  ]);
  const now = institutionNow();
  const followUp = snap.rows
    .filter((r) => r.access.risk && r.student.risk.level !== "none")
    .map((r) => r.student)
    .sort(riskOrder)
    .slice(0, 6);
  return (
    <div className="space-y-6">
      <HealthBanner pulse={pulse} />
      <TodoList items={todo} />
      <Section
        title={today ? `Today's classes — ${weekdayName(today.date)}` : "Today's classes"}
        href={`/attendance/sections/${sectionId}`}
        linkLabel="Class register"
      >
        <ScheduleList
          classes={today?.classes ?? []}
          now={institutionToday().time}
          emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
        />
      </Section>
      <Glance
        items={glanceFrom(pulse, {
          attendance: `/attendance/sections/${sectionId}`,
          eligibility: studentsHref({ sectionId, shortage: true, sort: "attendance" }),
          risk: studentsHref({ sectionId, risk: "high" }),
          operations: "/approvals",
        })}
      />
      <NoticesSection items={inbox} now={now} />
      <MoreDetails>
        <Grid className="xl:grid-cols-2">
          <TrendCard
            title="Class attendance, week by week"
            points={trendPoints(snap.trend)}
            threshold={snap.threshold}
            definition={TREND_DEFINITION}
          />
          <Panel
            title="Students to keep an eye on"
            description="And why, for each student"
            href={studentsHref({ sectionId, sort: "attendance" })}
            hrefLabel="Class list"
            flush
          >
            <StudentRiskCard students={followUp} empty="Everyone in your class is doing fine." />
          </Panel>
        </Grid>
      </MoreDetails>
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
  const [todo, today, inbox] = await Promise.all([
    attentionFor(authed, "teaching", unit),
    classesOn(authed, { mine: true }),
    notices(authed),
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
  return (
    <div className="space-y-6">
      <TodoList items={todo} />
      <Section title="Today's classes" href="/attendance" linkLabel="Attendance">
        <ScheduleList
          classes={today?.classes ?? []}
          now={institutionToday().time}
          showSection
          emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
        />
      </Section>
      <Glance
        items={[
          {
            key: "students",
            label: "Students you teach",
            value: String(rows.length),
            note: `In ${pluralize(sectionIds.length, "section")} · ${courseCodes.join(", ") || "no courses this term"}`,
            href: "/my/courses",
          },
          {
            key: "attendance",
            label: "Attendance in your classes",
            value: courseRows.length ? `${avg.toFixed(1)}%` : "—",
            note: "Average for the courses you teach",
            href: "/my/courses",
          },
          {
            key: "below",
            label: "Students below 75%",
            value: String(below.length),
            note: "In at least one of your courses",
            status: below.length ? "watch" : "good",
            href: "/my/courses",
          },
        ]}
      />
      <NoticesSection items={inbox} now={now} />
      <MoreDetails
        label="Show students below the attendance needed"
        hint="Who they are, and how many classes each must attend"
      >
        <Panel
          title="Students below the attendance needed"
          description="And how many classes each must attend to catch up"
          flush
        >
          {below.length === 0 ? (
            <p className="text-muted px-5 py-8 text-center text-[15px]">
              No student is below what is needed in your courses.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {below.slice(0, 10).map((r) => (
                <li
                  key={`${r.student.id}-${r.subj.courseCode}`}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <Link href={`/students/${r.student.id}`} className="hover:text-brand min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{r.student.name}</p>
                    <p className="text-muted text-sm">
                      {r.subj.courseCode} · {r.student.sectionLabel} · came to {r.subj.attended} of{" "}
                      {r.subj.held}
                    </p>
                  </Link>
                  <span className="text-danger tabular text-[15px] font-semibold">{r.pct.toFixed(0)}%</span>
                  <span className="text-muted w-32 text-right text-sm">must attend next {r.mustAttend}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </MoreDetails>
    </div>
  );
}

/* ---------- Student and guardian ---------- */

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
  const [todo, subjects, today, inbox, exams] = await Promise.all([
    attentionFor(authed, workspace, unit, record),
    subjectsFor(authed, record),
    classesOn(authed, { sectionCode: me.sectionId }),
    notices(authed),
    studentExams(authed, record),
  ]);
  const now = institutionNow();
  const projected = subjects.map((s) => ({ ...s, ...projectAttendance(s.attended, s.held, threshold) }));
  const nowDate = now.toISOString().slice(0, 10);
  const nextPaper = (exams?.sittings ?? [])
    .flatMap((s) => s.papers)
    .filter((p) => p.slot && p.slot.date >= nowDate)
    .sort((a, b) => a.slot!.date.localeCompare(b.slot!.date))[0];
  const guardian = workspace === "guardian";
  const short = me.attendancePct < threshold;

  return (
    <div className="space-y-6">
      <TodoList items={todo} />
      <Section
        title={guardian ? "Classes today" : "My classes today"}
        href="/my/timetable"
        linkLabel="Full timetable"
      >
        <ScheduleList
          classes={today?.classes ?? []}
          now={institutionToday().time}
          emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
        />
      </Section>
      <Glance
        items={[
          {
            key: "attendance",
            label: "Attendance",
            value: `${me.attendancePct.toFixed(1)}%`,
            note: short ? `Below the ${threshold}% needed` : `Above the ${threshold}% needed`,
            status: short ? "critical" : "good",
            href: "/my/attendance",
          },
          {
            key: "cgpa",
            label: "CGPA",
            value: me.cgpa > 0 ? me.cgpa.toFixed(2) : "—",
            note: me.backlogs
              ? `${me.backlogs} subject${me.backlogs > 1 ? "s" : ""} to clear`
              : "No subjects to clear",
            status: me.backlogs ? "watch" : "good",
            href: "/my/academics",
          },
          {
            key: "exam",
            label: "Next exam",
            value: nextPaper ? formatDate(nextPaper.slot!.date).replace(/ \d{4}$/, "") : "—",
            note: nextPaper ? `${nextPaper.courseCode} ${nextPaper.courseName}` : "No exam scheduled yet",
            href: "/my/exams",
          },
        ]}
      />
      <NoticesSection items={inbox} now={now} />
      <MoreDetails
        label="Show attendance for each subject"
        hint="Subject by subject, with how many classes can still be missed"
      >
        <Panel
          title="Attendance for each subject"
          description={`You need ${threshold}% in every subject`}
          href="/my/attendance"
          hrefLabel="Details and leave"
          flush
        >
          <ul className="divide-border divide-y">
            {projected.map((s) => {
              const below = s.pct < threshold;
              return (
                <li key={s.courseCode} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[15px] font-medium">{s.courseName}</p>
                    <span className={cn("tabular text-[17px] font-semibold", below && "text-danger")}>
                      {s.pct.toFixed(1)}%
                    </span>
                  </div>
                  <Meter
                    value={s.pct}
                    tone={below ? "danger" : s.canMiss <= 2 ? "warning" : "brand"}
                    label={`${s.courseName} attendance`}
                    className="mt-1.5"
                  />
                  <p className={cn("mt-1 text-sm", below ? "text-danger" : "text-muted")}>
                    {below
                      ? `Attend the next ${s.mustAttend} classes to reach ${threshold}%`
                      : s.canMiss === 0
                        ? "Don't miss the next class"
                        : `Can miss ${s.canMiss} more and still be fine`}
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>
      </MoreDetails>
    </div>
  );
}

/* ---------- Shared blocks for other workspaces ---------- */

/** The to-do list for workspaces whose own detail is rendered separately (exam cell, admin, offices). */
export async function AttentionOnly({
  authed,
  workspace,
  unit,
}: {
  authed: Authed;
  workspace: WorkspaceKind;
  unit: OrgNode;
}) {
  return <TodoList items={await attentionFor(authed, workspace, unit)} />;
}

export async function AnnouncementsAndActivity({ authed }: { authed: Authed }) {
  const [inbox, activity] = await Promise.all([notices(authed), recentActivity(authed)]);
  const now = institutionNow();
  return (
    <>
      <NoticesSection items={inbox} now={now} />
      <MoreDetails label="Show what happened recently" hint="Recent notices, messages and decisions">
        <Panel title="What happened recently" flush>
          <ActivityList items={activity} now={now} />
        </Panel>
      </MoreDetails>
    </>
  );
}
