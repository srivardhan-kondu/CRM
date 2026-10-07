import { BookOpen, GraduationCap, ListX } from "lucide-react";
import type { Metadata } from "next";
import { WidgetCard } from "@/components/dashboard/widgets";
import { ActionButton } from "@/components/exams/entry-sheet";
import { InsightCard } from "@/components/patterns/insight-card";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { requestRevaluationAction } from "@/app/(app)/exams/actions";
import { studentAcademics } from "@/domains/exams/repository";
import { REVALUATION_DAYS } from "@/domains/exams/rules";
import { linkedStudents } from "@/domains/students/repository";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Academics" };

const OUTCOME_TONE: Record<string, BadgeTone> = {
  pass: "success",
  fail: "danger",
  absent: "danger",
  not_eligible: "danger",
};
const OUTCOME_TEXT: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  absent: "Absent",
  not_eligible: "Not eligible",
};

export default async function MyAcademicsPage() {
  const authed = await requireAuth();
  const workspace = authed.ctx.active ? workspaceFor(authed.ctx.active.roleKey) : "operations";
  const [record] = await linkedStudents(authed, workspace === "guardian" ? "guardian" : "self");
  const data = record ? await studentAcademics(authed, record) : null;
  if (!record || !data)
    return (
      <>
        <PageHeader title="Academics" />
        <PermissionState description="This page shows a student's own results. Your account is not linked to a student record." />
      </>
    );
  const me = record.student;

  return (
    <>
      <PageHeader
        title={workspace === "guardian" ? `${me.name}'s results` : "My academics"}
        description={`${me.programme} · ${me.studentNumber} · semester ${me.semester}`}
      />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InsightCard
          icon={GraduationCap}
          label="CGPA"
          value={data.semesters.length ? data.standing.cgpa.toFixed(2) : "—"}
          context={data.semesters.length ? `Over ${data.semesters.length} semesters` : "No results yet"}
          definition="Credit-weighted grade points of each course's latest attempt; backlogs count 0"
        />
        <InsightCard
          icon={BookOpen}
          label="Credits earned"
          value={`${me.creditsEarned}/${me.creditsRequired}`}
          context={`${((me.creditsEarned / Math.max(1, me.creditsRequired)) * 100).toFixed(0)}% of the programme`}
          definition="Credits of passed courses"
        />
        <InsightCard
          icon={ListX}
          label="Backlogs"
          value={data.standing.backlogs}
          context={data.standing.backlogs ? "Courses still to clear" : "None"}
          definition="Courses whose latest attempt is not a pass"
          tone={data.standing.backlogs ? "warning" : "success"}
        />
      </div>
      <div className="space-y-5">
        {[...data.semesters].reverse().map((sem) => (
          <WidgetCard
            key={sem.semester}
            title={`Semester ${sem.semester}`}
            description={`${sem.termName} · SGPA ${sem.sgpa.toFixed(2)} · ${sem.credits} credits`}
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                    <th className="px-4 py-2 font-medium">Course</th>
                    <th className="px-3 py-2 text-right font-medium">Internal</th>
                    <th className="px-3 py-2 text-right font-medium">External</th>
                    <th className="px-3 py-2 text-right font-medium">Grade</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-4 py-2">
                      <span className="sr-only">Revaluation</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {sem.results.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2">
                        <span className="font-medium">{r.courseName}</span>{" "}
                        <span className="text-2xs text-subtle font-mono">{r.courseCode}</span>
                        <span className="text-2xs text-subtle block">
                          {r.credits} credits{r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {r.cie}/{r.cieMax}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {r.see ?? "—"}/{r.seeMax}
                        {r.originalSee !== null && (
                          <span className="text-2xs text-subtle block">was {r.originalSee}</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "tabular px-3 py-2 text-right font-semibold",
                          r.outcome !== "pass" && "text-danger",
                        )}
                      >
                        {r.grade ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_TEXT[r.outcome]}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {r.revaluation ? (
                          <Badge tone={r.revaluation.status === "completed" ? "success" : "info"}>
                            Revaluation {r.revaluation.status}
                          </Badge>
                        ) : r.canRevalue ? (
                          <ActionButton
                            action={requestRevaluationAction}
                            hidden={{ resultId: r.id }}
                            label="Request revaluation"
                            variant="secondary"
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WidgetCard>
        ))}
        {data.semesters.length === 0 && (
          <p className="text-muted text-sm">No results are published for you yet.</p>
        )}
        <p className="text-2xs text-subtle">
          Grades are absolute on a 10-point scale (O ≥ 90%, A+ ≥ 80, A ≥ 70, B+ ≥ 60, B ≥ 50, C ≥ 45, P ≥ 40).
          A pass needs 35% in the external examination and 40% overall. Revaluation of theory scripts is open
          for {REVALUATION_DAYS} days after publication; the higher mark stands.
        </p>
      </div>
    </>
  );
}
