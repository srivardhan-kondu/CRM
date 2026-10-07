import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalList, DrillLink, WidgetCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { weekdayName } from "@/domains/attendance/calendar";
import { markHref } from "@/domains/attendance/links";
import { myOpenSessions, pendingApprovalsFor, type ClassOccurrence } from "@/domains/attendance/repository";
import { requireAuth } from "@/lib/authz/context";
import { institutionNow } from "@/lib/clock";
import { formatDate, pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Tasks" };

function ClassRows({
  list,
  action,
}: {
  list: ClassOccurrence[];
  action: (c: ClassOccurrence) => React.ReactNode;
}) {
  return (
    <ul className="divide-border divide-y text-sm">
      {list.map((c) => (
        <li key={c.key} className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-32 shrink-0 text-xs">
            {weekdayName(c.date).slice(0, 3)}, {formatDate(c.date)}
            <span className="text-subtle block">
              {c.startsAt}–{c.endsAt}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate">
            {c.courseCode} · {c.courseName}
            <span className="text-2xs text-subtle block">{c.sectionLabel}</span>
          </span>
          {action(c)}
        </li>
      ))}
    </ul>
  );
}

export default async function TasksPage() {
  const authed = await requireAuth();
  const [open, approvals] = await Promise.all([myOpenSessions(authed), pendingApprovalsFor(authed)]);
  const markNow = open?.markNow ?? [];
  const overdue = open?.overdue ?? [];
  const awaiting = open?.awaiting ?? [];
  const nothing = markNow.length + overdue.length + awaiting.length === 0 && !approvals?.length;

  return (
    <>
      <PageHeader title="Tasks" description="Attendance to mark and decisions waiting on you" />
      {nothing ? (
        <EmptyState
          icon={ListChecks}
          title="You're all caught up"
          description="No attendance to mark and nothing to decide."
        />
      ) : (
        <div className="space-y-5">
          {markNow.length > 0 && (
            <WidgetCard
              title="Mark now"
              description="Today's classes that have started — open until midnight"
              flush
            >
              <ClassRows
                list={markNow}
                action={(c) => (
                  <Button asChild size="sm">
                    <Link href={markHref(c)}>Mark attendance</Link>
                  </Button>
                )}
              />
            </WidgetCard>
          )}
          {overdue.length > 0 && (
            <WidgetCard
              title="Not marked on the day"
              description={`${pluralize(overdue.length, "class", "classes")} · submit late; it counts once your HOD approves it`}
              flush
            >
              <ClassRows
                list={overdue}
                action={(c) => (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={markHref(c)}>Submit late</Link>
                  </Button>
                )}
              />
            </WidgetCard>
          )}
          {awaiting.length > 0 && (
            <WidgetCard title="Awaiting approval" description="Late submissions you sent" flush>
              <ClassRows list={awaiting} action={() => <Badge tone="info">With HOD</Badge>} />
            </WidgetCard>
          )}
          {approvals && approvals.length > 0 && (
            <WidgetCard
              title="Decisions waiting on you"
              action={<DrillLink href="/approvals">Approvals</DrillLink>}
              flush
            >
              <ApprovalList items={approvals} now={institutionNow()} />
            </WidgetCard>
          )}
        </div>
      )}
    </>
  );
}
