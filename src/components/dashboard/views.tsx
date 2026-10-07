import Link from "next/link";
import { BookOpen, CalendarCheck, GraduationCap, ShieldAlert, Users, Wallet } from "lucide-react";
import { InsightCard } from "@/components/patterns/insight-card";
import { FeeBadge } from "@/components/patterns/status";
import { Meter } from "@/components/ui/misc";
import { listInbox } from "@/domains/announcements/repository";
import { projectAttendance } from "@/domains/attendance/projection";
import { attendanceContext, classesOn, pendingApprovalsFor } from "@/domains/attendance/repository";
import { groupBy, summarize, type Visible } from "@/domains/students/query";
import { subjectsFor, visibleStudents, visibleStudentsIn } from "@/domains/students/repository";
import { studentsHref } from "@/domains/students/params";
import type { Student } from "@/domains/students/types";
import type { Authed } from "@/lib/authz/context";
import { descendantsOfType } from "@/lib/authz/org-tree";
import type { OrgNode } from "@/lib/authz/types";
import { weekdayName } from "@/domains/attendance/calendar";
import { institutionNow, institutionToday } from "@/lib/clock";
import { ATTENDANCE_THRESHOLD } from "@/lib/demo/fixtures";
import { cn, formatCompactINR, formatNumber, formatPercent, pluralize } from "@/lib/utils";
import {
  ApprovalList,
  AttentionList,
  DrillLink,
  NoticeList,
  ScheduleList,
  ThresholdBars,
  WidgetCard,
  type BarRow,
} from "./widgets";

const DEFINITIONS = {
  attendance: "Mean of overall attendance % (OD counts as attended; medical leave is excused)",
  shortage: "Students below their programme's attendance threshold",
  risk: "≥2 academic risk factors, or attendance < 65%",
  fee: "Balance past the semester due date",
  cgpa: "Mean CGPA of students with graded semesters",
};

function bySeverity(a: Student, b: Student) {
  const rank = { high: 0, watch: 1, none: 2 } as const;
  return rank[a.risk.level] - rank[b.risk.level] || a.attendancePct - b.attendancePct;
}

const institutionNowTime = () => institutionToday().time;

/** Mean attendance over rows whose academics the viewer may read. */
function avg(rows: Visible[]) {
  const readable = rows.filter((r) => r.access.academic);
  return readable.length ? readable.reduce((n, r) => n + r.student.attendancePct, 0) / readable.length : 0;
}

function shortCount(rows: Visible[]) {
  return rows.filter((r) => r.access.academic && r.student.attendancePct < r.student.attendanceThreshold)
    .length;
}

/** The institution threshold, for cohort-level lines and labels (programmes may set their own). */
async function institutionThreshold(authed: Authed) {
  return (await attendanceContext(authed))?.thresholdPct ?? ATTENDANCE_THRESHOLD;
}

/** Students flagged at the given levels, limited to rows where the viewer may read risk. */
function flagged(rows: Visible[], levels: Student["risk"]["level"][]) {
  return rows.filter((r) => r.access.risk && levels.includes(r.student.risk.level)).map((r) => r.student);
}

/* ---------- Leadership & department workspaces (Director, Principal, Dean, HOD, coordinators) ---------- */

export async function LeadershipDashboard({ authed, unit }: { authed: Authed; unit: OrgNode }) {
  const rows = await visibleStudentsIn(authed, unit);
  const sum = summarize(rows);
  // Above department level, compare departments; at department level, compare sections.
  const byDepartment = unit.type !== "department";
  const deptCode = unit.type === "department" ? unit.code : undefined;
  const approvals = (await pendingApprovalsFor(authed)) ?? [];
  const notices = (await listInbox(authed, "mine")).slice(0, 4);
  const threshold = await institutionThreshold(authed);

  const bars: BarRow[] = byDepartment
    ? descendantsOfType(authed.tree, unit, "department")
        .map((node) => {
          const list = rows.filter((r) => r.student.departmentCode === node.code);
          const short = shortCount(list);
          return {
            key: node.code,
            label: node.name,
            sublabel: `${list[0]?.student.programme ?? node.code} · ${pluralize(list.length, "student")}`,
            value: avg(list),
            href: studentsHref({ department: node.code, sort: "attendance" }),
            flag: short ? `${short} short` : undefined,
            count: list.length,
          };
        })
        .filter((b) => b.count > 0)
    : [...groupBy(rows, (r) => r.student.sectionId)].map(([sectionId, list]) => {
        const first = list[0]!.student;
        const short = shortCount(list);
        return {
          key: sectionId,
          label: first.sectionLabel,
          sublabel: `Batch ${first.batch} · ${list.length} students`,
          value: avg(list),
          href: studentsHref({ sectionId, sort: "attendance" }),
          flag: short ? `${short} short` : undefined,
        };
      });
  bars.sort((a, b) => a.value - b.value);

  const attention = flagged(rows, ["high"]).sort(bySeverity).slice(0, 6);
  const base = deptCode ? { department: deptCode } : {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={Users}
          label={deptCode ? `${deptCode} students` : `Active students · ${unit.name}`}
          value={formatNumber(sum.active)}
          context={`${formatNumber(sum.total - sum.active)} on leave or detained`}
          definition="Enrolled students in scope, current term"
          href={studentsHref(base)}
        />
        <InsightCard
          icon={CalendarCheck}
          label="Average attendance"
          value={formatPercent(sum.avgAttendance, 1)}
          context={`${pluralize(sum.shortage, "student")} below threshold`}
          definition={DEFINITIONS.attendance}
          tone={sum.avgAttendance < threshold + 5 ? "warning" : "success"}
          href={studentsHref({ ...base, shortage: true, sort: "attendance" })}
        />
        <InsightCard
          icon={ShieldAlert}
          label="High-risk students"
          value={formatNumber(sum.highRisk)}
          context={`${formatNumber(sum.watch)} more on watch`}
          definition={DEFINITIONS.risk}
          tone={sum.highRisk > 0 ? "danger" : "success"}
          href={studentsHref({ ...base, risk: "high", sort: "attendance" })}
        />
        {sum.financeCount > 0 ? (
          <InsightCard
            icon={Wallet}
            label="Fees overdue"
            value={formatNumber(sum.feeOverdue)}
            context={`${formatCompactINR(sum.feeOutstanding)} outstanding across all dues`}
            definition={DEFINITIONS.fee}
            tone={sum.feeOverdue > 0 ? "warning" : "success"}
            href={studentsHref({ ...base, fee: "overdue" })}
          />
        ) : (
          <InsightCard
            icon={GraduationCap}
            label="Average CGPA"
            value={sum.avgCgpa.toFixed(2)}
            context="Across graded semesters"
            definition={DEFINITIONS.cgpa}
            href={studentsHref({ ...base, sort: "cgpa" })}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <WidgetCard
          title={byDepartment ? "Attendance by department" : "Attendance by section"}
          description={`Lowest first. Line marks the institution's ${threshold}% eligibility threshold.`}
          action={<DrillLink href="/attendance">Attendance</DrillLink>}
        >
          <ThresholdBars rows={bars} threshold={threshold} />
        </WidgetCard>
        <WidgetCard
          title="Needs attention"
          description="High-risk students with the factors behind each flag"
          action={<DrillLink href={studentsHref({ ...base, risk: "high" })}>All {sum.highRisk}</DrillLink>}
          flush
        >
          <AttentionList students={attention} empty="No students currently cross the high-risk definition." />
        </WidgetCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <WidgetCard
          title="Pending approvals"
          description={`${approvals.filter((a) => a.overdue).length} past SLA`}
          action={<DrillLink href="/approvals">Queue</DrillLink>}
          flush
        >
          <ApprovalList items={approvals} now={institutionNow()} />
        </WidgetCard>
        <WidgetCard
          title="Latest notices"
          description="Active announcements in your scope"
          action={<DrillLink href="/announcements">Inbox</DrillLink>}
          flush
        >
          <NoticeList items={notices} />
        </WidgetCard>
      </div>
    </div>
  );
}

/* ---------- Class incharge ---------- */

export async function ClassInchargeDashboard({ authed, unit }: { authed: Authed; unit: OrgNode }) {
  const sectionId = unit.code;
  const rows = await visibleStudentsIn(authed, unit);
  const sum = summarize(rows);
  const today = await classesOn(authed, { sectionCode: sectionId });
  const watch = flagged(rows, ["high", "watch"]).sort(bySeverity).slice(0, 8);
  const notices = (await listInbox(authed, "mine")).slice(0, 4);
  const approvals = (await pendingApprovalsFor(authed)) ?? [];
  const threshold = await institutionThreshold(authed);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={Users}
          label="Class strength"
          value={sum.total}
          context={`${sum.active} active`}
          definition="Students enrolled in this section"
          href={studentsHref({ sectionId })}
        />
        <InsightCard
          icon={CalendarCheck}
          label="Class attendance"
          value={formatPercent(sum.avgAttendance, 1)}
          context="Term to date, all subjects"
          definition={DEFINITIONS.attendance}
          tone={sum.avgAttendance < threshold + 5 ? "warning" : "success"}
          href={`/attendance/sections/${sectionId}`}
        />
        <InsightCard
          icon={ShieldAlert}
          label="Below threshold"
          value={sum.shortage}
          context="Exam eligibility at risk"
          definition={DEFINITIONS.shortage}
          tone={sum.shortage ? "danger" : "success"}
          href={studentsHref({ sectionId, shortage: true, sort: "attendance" })}
        />
        <InsightCard
          icon={GraduationCap}
          label="Need follow-up"
          value={sum.highRisk + sum.watch}
          context={`${sum.highRisk} high risk · ${sum.watch} watch`}
          definition="Any academic risk factor present"
          tone={sum.highRisk ? "warning" : "neutral"}
          href={studentsHref({ sectionId, risk: "high" })}
        />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <WidgetCard
          title="Today's timetable"
          description={today ? `${weekdayName(today.date)} · ${unit.name}` : "No current term"}
          action={<DrillLink href={`/attendance/sections/${sectionId}`}>Class attendance</DrillLink>}
          flush
        >
          <ScheduleList
            classes={today?.classes ?? []}
            now={institutionNowTime()}
            emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
          />
        </WidgetCard>
        <WidgetCard
          title="Follow-up list"
          description="Students with active risk factors, most urgent first"
          action={<DrillLink href={studentsHref({ sectionId, sort: "attendance" })}>Class list</DrillLink>}
          flush
        >
          <AttentionList students={watch} empty="Everyone in your class is on track." />
        </WidgetCard>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <WidgetCard
          title="Leave to decide"
          description="On-duty and medical leave for your class"
          action={<DrillLink href="/approvals">Approvals</DrillLink>}
          flush
        >
          <ApprovalList items={approvals} now={institutionNow()} />
        </WidgetCard>
        <WidgetCard
          title="Notices for this class"
          action={<DrillLink href="/announcements">Inbox</DrillLink>}
          flush
        >
          <NoticeList items={notices} />
        </WidgetCard>
      </div>
    </div>
  );
}

/* ---------- Faculty ---------- */

/** Aggregates every teaching assignment the user holds, whichever one is the active workspace. */
export async function FacultyDashboard({ authed }: { authed: Authed }) {
  const teaching = authed.ctx.assignments.filter((a) => a.roleKey === "faculty");
  const sectionIds = [
    ...new Set(teaching.map((a) => authed.tree.byId.get(a.orgUnitId)?.code).filter((c): c is string => !!c)),
  ];
  const courseCodes = [...new Set(teaching.flatMap((a) => a.courseCodes ?? []))];
  if (courseCodes.length === 0) return null;
  const rows = (await visibleStudents(authed)).filter((v) => sectionIds.includes(v.student.sectionId));
  const today = await classesOn(authed, { mine: true });
  const schedule = today?.classes ?? [];
  const course = courseCodes[0]!;

  const courseRows = (
    await Promise.all(
      rows.map(async (v) => {
        const subj = (await subjectsFor(authed, v)).find((x) => x.courseCode === course);
        return subj
          ? {
              student: v.student,
              ...projectAttendance(subj.attended, subj.held, v.student.attendanceThreshold),
              subj,
            }
          : null;
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);
  const below = courseRows.filter((r) => r.pct < r.student.attendanceThreshold).sort((a, b) => a.pct - b.pct);
  const threshold = await institutionThreshold(authed);
  const toMark = schedule.filter((c) => c.window === "open" && c.canMark && !c.recorded).length;
  const courseAvg = courseRows.reduce((n, r) => n + r.pct, 0) / Math.max(1, courseRows.length);
  const courseName = courseRows[0]?.subj.courseName ?? course;
  const notices = (await listInbox(authed, "mine")).slice(0, 4);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={Users}
          label="Students taught"
          value={rows.length}
          context={`${sectionIds.length} sections · ${course}`}
          definition="Students enrolled in your assigned sections"
          href={studentsHref({})}
        />
        <InsightCard
          icon={BookOpen}
          label={`${course} attendance`}
          value={formatPercent(courseAvg, 1)}
          context={courseName}
          definition={`Mean of ${course} attendance % · threshold ${threshold}%`}
          tone={courseAvg < threshold + 5 ? "warning" : "success"}
        />
        <InsightCard
          icon={ShieldAlert}
          label={`Below threshold in ${course}`}
          value={below.length}
          context="Subject-level shortage"
          definition={`Students under their programme threshold in ${course}`}
          tone={below.length ? "danger" : "success"}
        />
        <InsightCard
          icon={CalendarCheck}
          label="Classes today"
          value={schedule.length}
          context={
            toMark
              ? `${pluralize(toMark, "class")} to mark now`
              : schedule[0]
                ? `First at ${schedule[0].startsAt}`
                : "No classes"
          }
          definition="From the published timetable"
          tone={toMark ? "warning" : "neutral"}
          href="/attendance"
        />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <WidgetCard
          title="My classes today"
          description="Mark attendance once the class starts, on the same day"
          action={<DrillLink href="/tasks">Tasks</DrillLink>}
          flush
        >
          <ScheduleList
            classes={schedule}
            now={institutionNowTime()}
            showSection
            emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
          />
        </WidgetCard>
        <WidgetCard
          title={`${course} shortage`}
          description="Classes each student must attend consecutively to recover"
          flush
        >
          {below.length === 0 ? (
            <p className="text-muted px-4 py-8 text-center text-sm">
              No student is below the threshold in {course}.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                  <th className="px-4 py-2 font-medium">Student</th>
                  <th className="px-2 py-2 font-medium">Section</th>
                  <th className="px-2 py-2 text-right font-medium">Attended</th>
                  <th className="px-4 py-2 text-right font-medium">To recover</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {below.slice(0, 8).map((r) => (
                  <tr key={r.student.id} className="hover:bg-surface-muted">
                    <td className="px-4 py-2">
                      <Link href={`/students/${r.student.id}`} className="hover:text-brand font-medium">
                        {r.student.name}
                      </Link>
                      <div className="text-2xs text-subtle font-mono">{r.student.studentNumber}</div>
                    </td>
                    <td className="text-muted px-2 py-2 text-xs">{r.student.sectionLabel}</td>
                    <td className="tabular px-2 py-2 text-right">
                      <span className="text-danger font-medium">{r.pct.toFixed(0)}%</span>
                      <div className="text-2xs text-subtle">
                        {r.subj.attended}/{r.subj.held}
                      </div>
                    </td>
                    <td className="tabular px-4 py-2 text-right text-xs">{r.mustAttend} classes</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </WidgetCard>
      </div>
      <WidgetCard title="Notices" action={<DrillLink href="/announcements">Inbox</DrillLink>} flush>
        <NoticeList items={notices} />
      </WidgetCard>
    </div>
  );
}

/* ---------- Student ---------- */

/** Student home — also the guardian view of a linked child (field access decides what renders). */
export async function StudentDashboard({ authed, record }: { authed: Authed; record: Visible }) {
  const { student: me, access } = record;
  const threshold = me.attendanceThreshold;
  const subjects = (await subjectsFor(authed, record)).map((s) => ({
    ...s,
    ...projectAttendance(s.attended, s.held, threshold),
  }));
  const today = await classesOn(authed, { sectionCode: me.sectionId });
  const notices = (await listInbox(authed, "mine")).slice(0, 5);
  const creditsPct = (me.creditsEarned / me.creditsRequired) * 100;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={CalendarCheck}
          label="Overall attendance"
          value={formatPercent(me.attendancePct, 1)}
          context={
            me.attendancePct < threshold
              ? `Below the ${threshold}% exam eligibility threshold`
              : `Above the ${threshold}% threshold`
          }
          definition="Attended ÷ held, all subjects this term (OD counts as attended; medical leave is excused)"
          tone={me.attendancePct < threshold ? "danger" : "success"}
          href="/my/attendance"
        />
        <InsightCard
          icon={GraduationCap}
          label="CGPA"
          value={me.cgpa > 0 ? me.cgpa.toFixed(2) : "—"}
          context={
            me.backlogs ? `${me.backlogs} active backlog${me.backlogs > 1 ? "s" : ""}` : "No active backlogs"
          }
          definition="Cumulative grade point average"
          href={`/students/${me.id}`}
        />
        <InsightCard
          icon={BookOpen}
          label="Credits earned"
          value={`${me.creditsEarned}/${me.creditsRequired}`}
          context={`${creditsPct.toFixed(0)}% of programme requirement`}
          definition="Credits from passed courses"
        />
        {access.finance && (
          <InsightCard
            icon={Wallet}
            label="Fees"
            value={<FeeBadge status={me.feeStatus} />}
            context={
              me.feeDue
                ? `${formatCompactINR(me.feeDue)} outstanding · last date 15 Oct`
                : "No dues this semester"
            }
            definition="Odd semester tuition"
            tone={me.feeStatus === "overdue" ? "danger" : me.feeStatus === "due" ? "warning" : "success"}
          />
        )}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <WidgetCard
          title="Attendance by subject"
          description={`Projection against the ${threshold}% requirement`}
          action={<DrillLink href="/my/attendance">Details & leave</DrillLink>}
          flush
        >
          <ul className="divide-border divide-y">
            {subjects.map((s) => {
              const short = s.pct < threshold;
              return (
                <li key={s.courseCode} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium">
                      {s.courseName}{" "}
                      <span className="text-2xs text-subtle font-mono font-normal">{s.courseCode}</span>
                    </p>
                    <span className={cn("tabular text-sm font-semibold", short && "text-danger")}>
                      {s.pct.toFixed(1)}%
                    </span>
                  </div>
                  <Meter
                    value={s.pct}
                    tone={short ? "danger" : s.canMiss <= 2 ? "warning" : "brand"}
                    label={`${s.courseName} attendance`}
                    className="mt-1.5"
                  />
                  <p className={cn("mt-1 text-xs", short ? "text-danger" : "text-muted")}>
                    {s.attended}/{s.held} attended ·{" "}
                    {short
                      ? `attend the next ${s.mustAttend} classes to reach ${threshold}%`
                      : s.canMiss === 0
                        ? "you cannot miss the next class"
                        : `you can miss up to ${s.canMiss} more`}
                  </p>
                </li>
              );
            })}
          </ul>
        </WidgetCard>
        <div className="space-y-5">
          <WidgetCard
            title="Today"
            description={today ? `${weekdayName(today.date)} · ${me.sectionLabel}` : me.sectionLabel}
            flush
          >
            <ScheduleList
              classes={today?.classes ?? []}
              now={institutionNowTime()}
              emptyTitle={today?.holiday ? `Holiday — ${today.holiday}` : undefined}
            />
          </WidgetCard>
          <WidgetCard title="Notices for you" action={<DrillLink href="/announcements">All</DrillLink>} flush>
            <NoticeList items={notices} />
          </WidgetCard>
        </div>
      </div>
    </div>
  );
}
