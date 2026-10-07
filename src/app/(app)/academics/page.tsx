import { ArrowRight, CalendarRange, GraduationCap, Layers, Wand2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { generateOfferingsAction, setCurrentTermAction } from "@/app/(app)/academics/actions";
import { ActionButton } from "@/components/academics/controls";
import { RegulationStatus } from "@/components/academics/term-tabs";
import { WidgetCard } from "@/components/dashboard/widgets";
import { InsightCard } from "@/components/patterns/insight-card";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { canManageTerms } from "@/domains/academics/guards";
import { listProgrammes, pendingOfferings, termContext } from "@/domains/academics/repository";
import { requireAuth } from "@/lib/authz/context";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Academics" };

export default async function AcademicsPage() {
  const authed = await requireAuth();
  const { ctx, tree } = authed;
  const programmes = await listProgrammes(authed);
  if (!programmes) {
    return (
      <div className="border-border bg-surface rounded-lg border py-12 shadow-xs">
        <PermissionState description="The academic structure isn't part of your role." />
      </div>
    );
  }
  const { terms } = await termContext(authed);
  const manageTerms = canManageTerms(ctx, tree);
  const pending = await pendingOfferings(authed, terms);

  const students = programmes.reduce((n, p) => n + p.students, 0);
  const batches = programmes.reduce((n, p) => n + p.batches.length, 0);
  const regulations = programmes.flatMap((p) => p.regulations);
  const current = terms.find((t) => t.isCurrent);

  return (
    <>
      <PageHeader
        title="Academic structure"
        description="Programmes, their regulations, batches and terms. Offerings and teaching allocations follow from these."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Academics" }]}
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          icon={GraduationCap}
          label="Programmes"
          value={programmes.length}
          context={`${formatNumber(students)} students enrolled`}
          definition="Degree programmes offered by departments"
        />
        <InsightCard
          icon={Layers}
          label="Regulations"
          value={regulations.filter((r) => r.status === "active").length}
          context={`${regulations.filter((r) => r.status === "draft").length} draft under revision`}
          definition="Active curriculum versions; a batch follows one regulation for its whole programme"
        />
        <InsightCard
          icon={Layers}
          label="Batches"
          value={batches}
          context="Admission cohorts in progress"
          definition="Each batch is pinned to the regulation it was admitted under"
        />
        <InsightCard
          icon={CalendarRange}
          label="Current term"
          value={current ? current.name.replace(/ \d{4}–\d{2}$/, "") : "Not set"}
          context={
            current
              ? `${formatDate(current.startsOn)} – ${formatDate(current.endsOn)}`
              : "Set a current term below"
          }
          definition="Teaching access and Student 360 course lists follow the current term"
        />
      </div>

      <div className="space-y-5">
        <WidgetCard
          title="Terms"
          description="Switching the current term moves teaching access to that term's allocations on everyone's next request."
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                  <th className="px-4 py-2 font-medium">Term</th>
                  <th className="px-3 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 text-right font-medium">Offerings</th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {terms.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 font-medium">
                        {t.name}
                        {t.isCurrent && <Badge tone="brand">Current</Badge>}
                      </div>
                      <div className="text-2xs text-subtle font-mono">{t.code}</div>
                    </td>
                    <td className="text-muted px-3 py-2.5 text-xs whitespace-nowrap">
                      {formatDate(t.startsOn)} – {formatDate(t.endsOn)}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">
                      <Link href={`/courses?term=${t.code}`} className="hover:text-brand">
                        {formatNumber(t.offerings)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-2">
                        {(pending.get(t.id) ?? 0) > 0 && (
                          <ActionButton
                            run={generateOfferingsAction.bind(null, t.id)}
                            confirm={{
                              title: `Generate offerings for ${t.name}?`,
                              description: `${pending.get(t.id)} offerings will be created from each section's regulation for the semester its batch is in. Existing offerings are untouched; faculty are allocated separately.`,
                              confirmLabel: "Generate",
                            }}
                          >
                            <Wand2 /> Generate {pending.get(t.id)} offerings
                          </ActionButton>
                        )}
                        {manageTerms && !t.isCurrent && (
                          <ActionButton
                            run={setCurrentTermAction.bind(null, t.id)}
                            confirm={{
                              title: `Make ${t.name} the current term?`,
                              description:
                                "Faculty access, My Courses and every Student 360 course list switch to this term's offerings and allocations. Unallocated offerings leave those sections without a teacher.",
                              confirmLabel: "Make current",
                            }}
                          >
                            Make current
                          </ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WidgetCard>

        <WidgetCard
          title="Programmes"
          description="Open a programme for its regulations, semester plans and batches."
          flush
        >
          <ul className="divide-border divide-y">
            {programmes.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/academics/programmes/${p.code}`}
                  className="hover:bg-surface-muted flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 sm:w-72">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-2xs text-subtle">
                      <span className="font-mono">{p.code}</span> · {p.departmentName} · {p.durationYears}{" "}
                      years, {p.semesters} semesters
                    </p>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    {p.regulations.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs">{r.code}</span>
                        <RegulationStatus status={r.status} />
                      </span>
                    ))}
                  </div>
                  <div className="text-muted flex items-center gap-4 text-xs">
                    <span>{p.batches.length} batches</span>
                    <span className="tabular">{formatNumber(p.students)} students</span>
                    <ArrowRight aria-hidden className="text-subtle size-4" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </WidgetCard>
      </div>
    </>
  );
}
