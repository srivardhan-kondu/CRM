import { Archive, Lock, Send, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { changeRegulationStatusAction, removeRegulationCourseAction } from "@/app/(app)/academics/actions";
import { ActionButton, AddRegulationCourse, NewDraftDialog } from "@/components/academics/controls";
import { RegulationStatus } from "@/components/academics/term-tabs";
import { WidgetCard } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { getProgramme, listCourses } from "@/domains/academics/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatDate, formatNumber } from "@/lib/utils";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ reg?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).code };
}

const CATEGORY_TONE = {
  core: "neutral",
  elective: "info",
  lab: "success",
  project: "brand",
  foundation: "outline",
} as const;

export default async function ProgrammePage({ params, searchParams }: Props) {
  const authed = await requireAuth();
  const { code } = await params;
  const { reg } = await searchParams;
  const data = await getProgramme(authed, code);
  if (!data) notFound();
  const { programme: p, courses } = data;

  const regulation =
    p.regulations.find((r) => r.code === reg) ??
    [...p.regulations].reverse().find((r) => r.status === "active") ??
    p.regulations[0];
  const rows = courses.filter((c) => c.curriculumId === regulation?.id);
  const editable = !!regulation && regulation.status === "draft" && p.manageable;
  const catalogue = editable ? ((await listCourses(authed)) ?? []) : [];
  const present = new Set(rows.map((r) => r.courseId));
  const latestYear = Math.max(...p.regulations.map((r) => r.effectiveFromYear), new Date().getFullYear());

  return (
    <>
      <PageHeader
        title={p.name}
        description={`${p.departmentName} · ${p.level.toUpperCase()} · ${p.durationYears} years, ${p.semesters} semesters · ${formatNumber(p.students)} students`}
        breadcrumbs={[{ label: "Academics", href: "/academics" }, { label: p.code }]}
        actions={
          p.manageable && p.regulations.length > 0 ? (
            <NewDraftDialog
              sources={p.regulations.map((r) => ({ id: r.id, code: r.code }))}
              suggestedCode={`R${String(latestYear + 2).slice(2)}`}
              suggestedYear={latestYear + 2}
            />
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Regulation">
        {p.regulations.map((r) => (
          <Link
            key={r.id}
            role="tab"
            aria-selected={r.id === regulation?.id}
            href={`/academics/programmes/${p.code}?reg=${r.code}`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              r.id === regulation?.id
                ? "bg-surface text-foreground ring-border shadow-xs ring-1"
                : "text-muted hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <span className="font-mono">{r.code}</span> <RegulationStatus status={r.status} />
          </Link>
        ))}
      </div>

      {regulation && (
        <div className="space-y-5">
          <section
            aria-label="Regulation summary"
            className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4 shadow-xs md:flex-row md:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{regulation.name}</h2>
                <RegulationStatus status={regulation.status} />
              </div>
              <p className="text-muted mt-1 text-xs">
                For batches admitted from {regulation.effectiveFromYear}
                {regulation.derivedFromId &&
                  ` · derived from ${p.regulations.find((r) => r.id === regulation.derivedFromId)?.code ?? "an earlier regulation"}`}
                {regulation.publishedAt && ` · published ${formatDate(regulation.publishedAt.toISOString())}`}{" "}
                · {regulation.courses} courses · {regulation.credits} credits · {regulation.batches} batch
                {regulation.batches === 1 ? "" : "es"}
              </p>
              {regulation.status !== "draft" && (
                <p className="text-2xs text-subtle mt-1 flex items-center gap-1">
                  <Lock aria-hidden className="size-3" /> Published regulations are frozen. Revise by starting
                  a new regulation from this one.
                </p>
              )}
            </div>
            {p.manageable && regulation.status === "draft" && (
              <ActionButton
                variant="primary"
                run={changeRegulationStatusAction.bind(null, regulation.id, "active")}
                confirm={{
                  title: `Publish ${regulation.code}?`,
                  description:
                    "Its course list becomes frozen. New batches can then be admitted under it. Every semester must have at least one course.",
                  confirmLabel: "Publish",
                }}
              >
                <Send /> Publish
              </ActionButton>
            )}
            {p.manageable && regulation.status === "active" && (
              <ActionButton
                run={changeRegulationStatusAction.bind(null, regulation.id, "retired")}
                confirm={{
                  title: `Retire ${regulation.code}?`,
                  description:
                    "No new batch should be admitted under it. Batches already following it keep it until they graduate.",
                  confirmLabel: "Retire",
                }}
              >
                <Archive /> Retire
              </ActionButton>
            )}
          </section>

          {editable && (
            <WidgetCard
              title="Edit draft"
              description="Add catalogue courses to a semester. Create new courses under Courses → Catalogue."
            >
              <AddRegulationCourse
                curriculumId={regulation.id}
                semesters={p.semesters}
                courses={catalogue
                  .filter((c) => !present.has(c.id))
                  .map((c) => ({ id: c.id, code: c.code, name: c.name }))}
              />
            </WidgetCard>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: p.semesters }, (_, i) => i + 1).map((sem) => {
              const list = rows.filter((r) => r.semester === sem);
              const credits = list.reduce((n, r) => n + r.credits, 0);
              return (
                <WidgetCard
                  key={sem}
                  title={`Semester ${sem}`}
                  description={list.length ? `${list.length} courses · ${credits} credits` : "No courses yet"}
                  flush
                >
                  {list.length === 0 ? (
                    <p className="text-muted px-4 py-6 text-center text-sm">
                      {editable
                        ? "Add courses above."
                        : "This regulation defines no courses for this semester."}
                    </p>
                  ) : (
                    <ul className="divide-border divide-y">
                      {list.map((c) => (
                        <li key={c.courseId} className="flex items-center gap-3 px-4 py-2">
                          <span className="text-subtle w-14 shrink-0 font-mono text-xs">{c.code}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                          <Badge tone={CATEGORY_TONE[c.category]}>{c.category}</Badge>
                          <span className="tabular text-muted w-24 shrink-0 text-right text-xs">
                            {c.credits} cr · {c.lectureHours}-{c.tutorialHours}-{c.practicalHours}
                          </span>
                          {editable && (
                            <ActionButton
                              variant="ghost"
                              className="size-7 px-0"
                              run={removeRegulationCourseAction.bind(null, regulation.id, c.courseId)}
                            >
                              <X aria-label={`Remove ${c.code}`} />
                            </ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </WidgetCard>
              );
            })}
          </div>
          <p className="text-2xs text-subtle">Hours are lecture-tutorial-practical per week.</p>
        </div>
      )}

      <WidgetCard
        title="Batches"
        description="Each batch follows the regulation it was admitted under."
        className="mt-5"
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                <th className="px-4 py-2 font-medium">Batch</th>
                <th className="px-3 py-2 font-medium">Regulation</th>
                <th className="px-3 py-2 font-medium">Sections</th>
                <th className="px-4 py-2 text-right font-medium">Students</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {p.batches.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{b.name}</div>
                    <div className="text-2xs text-subtle font-mono">{b.code}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    <Link
                      href={`/academics/programmes/${p.code}?reg=${b.regulationCode}`}
                      className="hover:text-brand"
                    >
                      {b.regulationCode}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {b.sections.map((sec) => (
                        <Link key={sec.id} href={`/students?section=${sec.code}`}>
                          <Badge tone="outline">
                            {sec.label} · {sec.students}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">{formatNumber(b.students)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </WidgetCard>
    </>
  );
}
