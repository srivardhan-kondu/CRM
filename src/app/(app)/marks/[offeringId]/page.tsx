import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WidgetCard } from "@/components/dashboard/widgets";
import { DecideWithNote } from "@/components/exams/decide";
import { ActionButton, EntrySheet } from "@/components/exams/entry-sheet";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { moderateAction, saveMarksAction, submitComponentAction } from "@/app/(app)/exams/actions";
import { offeringAssessment } from "@/domains/exams/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Mark sheet" };

type Props = { params: Promise<{ offeringId: string }>; searchParams: Promise<{ c?: string }> };

export default async function MarkSheetPage({ params, searchParams }: Props) {
  const authed = await requireAuth();
  const { offeringId } = await params;
  const { c } = await searchParams;
  const a = await offeringAssessment(authed, offeringId);
  if (!a) notFound();
  const component =
    a.components.find((x) => x.key === c) ??
    a.components.find((x) => x.status !== "approved") ??
    a.components[0];
  if (!component) notFound();
  const marks = a.marks[component.id] ?? {};
  const editable = a.canEnter && component.status === "open";
  const canModerate =
    a.canModerate && component.status === "submitted" && component.submittedById !== a.viewerId;
  const others = a.components.filter((x) => x.id !== component.id);
  const label = `${component.label} — ${a.offering.courseCode} · ${a.offering.sectionLabel}`;

  return (
    <>
      <PageHeader
        title={`${a.offering.courseCode} · ${a.offering.courseName}`}
        description={`${a.offering.sectionLabel} · internal assessment, ${a.term.name}`}
        breadcrumbs={[
          { label: "Internal marks", href: "/marks" },
          { label: `${a.offering.courseCode} ${a.offering.sectionLabel}` },
        ]}
      />
      <nav aria-label="Components" className="mb-4 flex flex-wrap gap-2">
        {a.components.map((x) => (
          <Link
            key={x.id}
            href={`/marks/${a.offering.id}?c=${x.key}`}
            aria-current={x.id === component.id ? "page" : undefined}
            className={cn(
              "border-border rounded-md border px-3 py-1.5 text-sm",
              x.id === component.id
                ? "bg-brand-soft text-brand-soft-foreground border-transparent font-medium"
                : "hover:bg-surface-muted",
            )}
          >
            {x.label} <span className="text-subtle text-xs">/{x.maxMarks}</span>
          </Link>
        ))}
      </nav>
      <WidgetCard
        title={component.label}
        description={`Out of ${component.maxMarks} · ${component.entries} of ${a.students.length} entered`}
        action={
          <Badge
            tone={
              component.status === "approved"
                ? "success"
                : component.status === "submitted"
                  ? "warning"
                  : "neutral"
            }
          >
            {component.status === "approved"
              ? "Approved · locked"
              : component.status === "submitted"
                ? "With HOD"
                : "Open"}
          </Badge>
        }
      >
        <div className="space-y-4">
          {component.returnNote && component.status === "open" && (
            <p
              role="status"
              className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm"
            >
              Returned by {component.decidedBy}: “{component.returnNote}”
            </p>
          )}
          {component.status === "submitted" && (
            <p className="text-muted text-sm">
              Submitted by {component.submittedBy}
              {component.submittedAt && ` · ${formatDateTime(component.submittedAt.toISOString())}`}.
            </p>
          )}
          {component.status === "approved" && component.decidedBy && (
            <p className="text-muted text-sm">
              Approved by {component.decidedBy}
              {component.decidedAt && ` · ${formatDateTime(component.decidedAt.toISOString())}`}.
            </p>
          )}
          <EntrySheet
            key={`${component.id}-${component.status}`}
            readonly={!editable}
            action={saveMarksAction}
            hidden={{ componentId: component.id }}
            label="Save marks"
            rows={a.students.map((st) => ({
              id: st.id,
              studentNumber: st.studentNumber,
              name: st.name,
              max: component.maxMarks,
              marks: marks[st.id]?.marks ?? null,
              absent: marks[st.id]?.absent ?? false,
              aside: others
                .map((o) => {
                  const m = a.marks[o.id]?.[st.id];
                  return m
                    ? `${o.label.replace("Internal assessment", "IA")} ${m.absent ? "Ab" : m.marks}`
                    : null;
                })
                .filter(Boolean)
                .join(" · "),
            }))}
          />
          <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            {editable && (
              <>
                <p className="text-muted mr-auto text-xs">
                  Submit once every student has marks or is marked absent. Submitted marks go to the HOD.
                </p>
                <ActionButton
                  action={submitComponentAction}
                  hidden={{ componentId: component.id }}
                  label="Submit to HOD"
                  variant="secondary"
                />
              </>
            )}
            {canModerate && (
              <>
                <p className="text-muted mr-auto text-xs">Approving locks these marks for the result.</p>
                <DecideWithNote
                  action={moderateAction}
                  hidden={{ componentId: component.id }}
                  label={label}
                  other={{ value: "returned", text: "Return" }}
                />
              </>
            )}
          </div>
        </div>
      </WidgetCard>
    </>
  );
}
