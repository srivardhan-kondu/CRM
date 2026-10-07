import { ClipboardCheck, FileCheck2, Scale, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { DrillLink, WidgetCard } from "@/components/dashboard/widgets";
import { InsightCard } from "@/components/patterns/insight-card";
import { Badge } from "@/components/ui/badge";
import { condonationQueue, eligibility, examEvents, revaluationQueue } from "@/domains/exams/repository";
import type { Authed } from "@/lib/authz/context";
import { formatDate } from "@/lib/utils";

/** The Controller of Examinations' workspace: what is in progress and what waits on the exam cell. */
export async function ExamsDashboard({ authed }: { authed: Authed }) {
  const [events, condonations, revaluations, rows] = await Promise.all([
    examEvents(authed),
    condonationQueue(authed),
    revaluationQueue(authed),
    eligibility(authed),
  ]);
  const scheduled = (events ?? []).filter((e) => e.status === "scheduled");
  const toEnter = scheduled.reduce((n, e) => n + (e.registrations - e.entered), 0);
  const pendingCondonations = (condonations ?? []).filter((c) => c.status === "pending").length;
  const pendingRevaluations = (revaluations ?? []).filter((r) => r.status === "pending").length;
  const short = (rows ?? []).filter((r) => !r.maySit).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={ClipboardCheck}
          label="Marks to enter"
          value={toEnter}
          context={`${scheduled.length} examinations in progress`}
          definition="Semester-end entries not yet recorded"
          href="/exams"
        />
        <InsightCard
          icon={Scale}
          label="Condonation requests"
          value={pendingCondonations}
          context="Waiting for your decision"
          definition="Students within 10 points below their attendance threshold"
          tone={pendingCondonations ? "warning" : "success"}
          href="/exams"
        />
        <InsightCard
          icon={FileCheck2}
          label="Revaluations"
          value={pendingRevaluations}
          context="Scripts to re-mark"
          definition="Theory semester-end scripts; the higher mark stands"
          tone={pendingRevaluations ? "warning" : "neutral"}
          href="/exams"
        />
        <InsightCard
          icon={ShieldAlert}
          label="Not yet eligible"
          value={short}
          context="For the November examinations"
          definition="Below threshold without an approved condonation"
          tone={short ? "danger" : "success"}
          href="/exams"
        />
      </div>
      <WidgetCard title="Examinations" action={<DrillLink href="/exams">All</DrillLink>} flush>
        <ul className="divide-border divide-y text-sm">
          {(events ?? []).slice(0, 6).map((e) => (
            <li key={e.id}>
              <Link
                href={`/exams/${e.id}`}
                className="hover:bg-surface-muted flex items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{e.name}</span>
                  <span className="text-2xs text-subtle block">
                    {formatDate(e.startsOn)} – {formatDate(e.endsOn)}
                  </span>
                </span>
                <Badge tone={e.status === "published" ? "success" : "neutral"}>
                  {e.status === "published" ? "Published" : `Marks ${e.entered}/${e.registrations}`}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      </WidgetCard>
    </div>
  );
}
