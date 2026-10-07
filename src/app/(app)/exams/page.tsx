import type { Metadata } from "next";
import Link from "next/link";
import { WidgetCard } from "@/components/dashboard/widgets";
import { DecideWithNote, RevalueForm } from "@/components/exams/decide";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { completeRevaluationAction, decideCondonationAction } from "@/app/(app)/exams/actions";
import { condonationQueue, eligibility, examEvents, revaluationQueue } from "@/domains/exams/repository";
import { requireAuth } from "@/lib/authz/context";
import { formatDate, formatDateTime, pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Examinations" };

export default async function ExamsPage() {
  const authed = await requireAuth();
  const [events, condonations, revaluations, rows] = await Promise.all([
    examEvents(authed),
    condonationQueue(authed),
    revaluationQueue(authed),
    eligibility(authed),
  ]);
  if (!events)
    return (
      <>
        <PageHeader title="Examinations" />
        <PermissionState description="Examinations are run by the examination cell. Students see theirs under Exams." />
      </>
    );
  const counts = { eligible: 0, condonable: 0, not_eligible: 0 };
  for (const r of rows ?? []) counts[r.eligibility] += 1;
  const pendingCondonations = condonations?.filter((c) => c.status === "pending") ?? [];
  const pendingRevaluations = revaluations?.filter((r) => r.status === "pending") ?? [];

  return (
    <>
      <PageHeader
        title="Examinations"
        description="Timetables, semester-end marks, results, condonation and revaluation"
      />
      <div className="space-y-5">
        <WidgetCard title="Examinations" flush>
          <ul className="divide-border divide-y text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/exams/${e.id}`}
                  className="hover:bg-surface-muted flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-2xs text-subtle block">
                      {e.kind === "regular" ? "Regular" : "Supplementary"} · {formatDate(e.startsOn)} –{" "}
                      {formatDate(e.endsOn)} · {pluralize(e.registrations, "registration")}
                    </span>
                  </span>
                  {e.cie && (
                    <span className="text-muted text-xs">
                      Internal: {e.cie.approved}/{e.cie.total} approved
                    </span>
                  )}
                  {e.status === "published" ? (
                    <Badge tone="success">
                      Published {e.publishedAt ? formatDate(e.publishedAt.toISOString()) : ""}
                    </Badge>
                  ) : (
                    <Badge tone={e.entered === e.registrations && e.registrations > 0 ? "info" : "neutral"}>
                      Marks {e.entered}/{e.registrations}
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </WidgetCard>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <WidgetCard
            title="Eligibility this term"
            description="From overall attendance against each programme's threshold"
          >
            <dl className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-surface-muted rounded-md p-3">
                <dt className="text-2xs text-muted">Eligible</dt>
                <dd className="text-lg font-semibold">{counts.eligible}</dd>
              </div>
              <div className="bg-warning-soft rounded-md p-3">
                <dt className="text-2xs text-warning-soft-foreground">Condonation band</dt>
                <dd className="text-lg font-semibold">{counts.condonable}</dd>
              </div>
              <div className="bg-danger-soft rounded-md p-3">
                <dt className="text-2xs text-danger-soft-foreground">Not eligible</dt>
                <dd className="text-lg font-semibold">{counts.not_eligible}</dd>
              </div>
            </dl>
          </WidgetCard>

          {condonations && (
            <WidgetCard
              title="Condonation requests"
              description={`${pendingCondonations.length} waiting · students up to 10 points below their threshold`}
              flush
            >
              {pendingCondonations.length === 0 ? (
                <p className="text-muted px-4 py-8 text-center text-sm">
                  No condonation requests are waiting.
                </p>
              ) : (
                <ul className="divide-border divide-y text-sm">
                  {pendingCondonations.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <Link href={`/students/${c.studentId}`} className="hover:text-brand font-medium">
                          {c.studentName}
                        </Link>{" "}
                        <span className="text-2xs text-subtle font-mono">{c.studentNumber}</span>
                        <span className="text-muted block text-xs">
                          {c.attendancePct.toFixed(1)}% attendance ·{" "}
                          {c.requestedBy ?? "Recorded by the office"} · {formatDateTime(c.requestedAt)}
                        </span>
                        <span className="mt-1 block text-xs">“{c.reason}”</span>
                      </span>
                      {c.canDecide && (
                        <DecideWithNote
                          action={decideCondonationAction}
                          hidden={{ id: c.id }}
                          label={`condonation for ${c.studentName}`}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </WidgetCard>
          )}
        </div>

        {revaluations && (
          <WidgetCard
            title="Revaluation"
            description={`${pendingRevaluations.length} scripts to re-mark · the higher of the two marks stands`}
            flush
          >
            {revaluations.length === 0 ? (
              <p className="text-muted px-4 py-8 text-center text-sm">No revaluation requests.</p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {revaluations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">
                        {r.courseCode} · {r.studentName}
                      </span>{" "}
                      <span className="text-2xs text-subtle font-mono">{r.studentNumber}</span>
                      <span className="text-muted block text-xs">
                        Original {r.see ?? "—"}/{r.seeMax} · grade {r.grade ?? "—"} · requested{" "}
                        {formatDateTime(r.requestedAt)}
                      </span>
                    </span>
                    {r.status === "pending" ? (
                      <RevalueForm
                        action={completeRevaluationAction}
                        id={r.id}
                        max={r.seeMax}
                        label={`${r.courseCode} ${r.studentName}`}
                      />
                    ) : (
                      <Badge tone={r.status === "completed" ? "success" : "neutral"}>
                        {r.status === "completed" ? `Revalued ${r.revaluedSee}` : r.status}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </WidgetCard>
        )}
      </div>
    </>
  );
}
