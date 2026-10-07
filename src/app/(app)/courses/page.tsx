import { AlertTriangle, BookOpen, CalendarRange, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AllocateDialog,
  CandidatesProvider,
  NewCourseDialog,
  RemoveAllocationDialog,
} from "@/components/academics/controls";
import { TermTabs } from "@/components/academics/term-tabs";
import { WidgetCard } from "@/components/dashboard/widgets";
import { InsightCard } from "@/components/patterns/insight-card";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, PermissionState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import {
  allocationCandidates,
  courseOwnerOptions,
  listCourses,
  listOfferings,
  termContext,
  type OfferingView,
} from "@/domains/academics/repository";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Courses" };

type Search = { term?: string; tab?: string };

export default async function CoursesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const authed = await requireAuth();
  const sp = await searchParams;
  const tab = sp.tab === "catalogue" ? "catalogue" : "offerings";
  const { terms, term } = await termContext(authed, sp.term);
  const href = (q: Search) => {
    const params = new URLSearchParams();
    const t = q.term ?? term?.code;
    if (t && !terms.find((x) => x.code === t)?.isCurrent) params.set("term", t);
    if ((q.tab ?? tab) === "catalogue") params.set("tab", "catalogue");
    const s = params.toString();
    return s ? `/courses?${s}` : "/courses";
  };

  const [offerings, catalogue] = await Promise.all([
    term ? listOfferings(authed, term.id) : Promise.resolve([]),
    listCourses(authed),
  ]);
  if (offerings === null || catalogue === null) {
    return (
      <div className="border-border bg-surface rounded-lg border py-12 shadow-xs">
        <PermissionState description="Courses and offerings aren't part of your role." />
      </div>
    );
  }

  const owners = courseOwnerOptions(authed).map((u) => ({ id: u.id, label: `${u.code} · ${u.name}` }));
  const canAllocateAny = offerings.some((o) => o.canAllocate);
  const candidates = term && canAllocateAny ? await allocationCandidates(authed, term.id) : [];
  const unallocated = offerings.filter((o) => o.allocations.length === 0);
  const sections = [...new Set(offerings.map((o) => o.sectionId))];

  return (
    <>
      <PageHeader
        title="Courses"
        description="What is taught to which section this term, who teaches it, and the course catalogue behind it."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Courses" }]}
        actions={owners.length > 0 && tab === "catalogue" ? <NewCourseDialog owners={owners} /> : undefined}
      />

      <div className="mb-3 flex gap-1" role="tablist" aria-label="View">
        {(["offerings", "catalogue"] as const).map((t) => (
          <Link
            key={t}
            role="tab"
            aria-selected={tab === t}
            href={href({ tab: t })}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              tab === t
                ? "bg-surface text-foreground ring-border shadow-xs ring-1"
                : "text-muted hover:bg-surface-muted hover:text-foreground",
            )}
          >
            {t === "offerings" ? "Offerings" : `Catalogue (${catalogue.length})`}
          </Link>
        ))}
      </div>

      {tab === "offerings" ? (
        <>
          <TermTabs terms={terms} active={term?.code} href={(code) => href({ term: code })} />
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <InsightCard
              icon={BookOpen}
              label="Offerings in scope"
              value={formatNumber(offerings.length)}
              context={`${sections.length} sections · ${term?.name ?? "no term"}`}
              definition="Course × section pairs for this term in your scope"
            />
            <InsightCard
              icon={AlertTriangle}
              label="Unallocated"
              value={unallocated.length}
              context={unallocated.length ? "Sections waiting for a teacher" : "Every offering has a teacher"}
              definition="Offerings with no active teaching allocation"
              tone={unallocated.length ? "warning" : "success"}
            />
            <InsightCard
              icon={Users}
              label="Faculty teaching"
              value={new Set(offerings.flatMap((o) => o.allocations.map((a) => a.userId))).size}
              context="Distinct faculty allocated in scope"
              definition="Allocation gives course-level access to that section's students"
              href="/faculty"
            />
          </div>
          {offerings.length === 0 ? (
            <div className="border-border bg-surface rounded-lg border shadow-xs">
              <EmptyState
                icon={CalendarRange}
                title={`No offerings for ${term?.name ?? "this term"} yet`}
                description="Offerings are generated from each batch's regulation on the Academics page."
              />
            </div>
          ) : (
            <CandidatesProvider candidates={candidates}>
              <OfferingsBySection offerings={offerings} />
            </CandidatesProvider>
          )}
        </>
      ) : (
        <WidgetCard
          title="Course catalogue"
          description="Shared by every regulation that uses a course."
          flush
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                  <th className="px-4 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Credits</th>
                  <th className="px-3 py-2 text-right font-medium">L-T-P</th>
                  <th className="px-4 py-2 text-right font-medium">Used in</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {catalogue.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-2xs text-subtle font-mono">{c.code}</div>
                    </td>
                    <td className="text-muted px-3 py-2 text-xs">{c.ownerCode}</td>
                    <td className="px-3 py-2 text-xs capitalize">{c.type}</td>
                    <td className="tabular px-3 py-2 text-right">{c.credits}</td>
                    <td className="tabular text-muted px-3 py-2 text-right text-xs">
                      {c.lectureHours}-{c.tutorialHours}-{c.practicalHours}
                    </td>
                    <td className="text-muted px-4 py-2 text-right text-xs whitespace-nowrap">
                      {c.regulations} regulation{c.regulations === 1 ? "" : "s"}
                      {c.sectionsThisTerm > 0 && ` · ${c.sectionsThisTerm} sections now`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WidgetCard>
      )}
    </>
  );
}

function OfferingsBySection({ offerings }: { offerings: OfferingView[] }) {
  const bySection = new Map<string, OfferingView[]>();
  for (const o of offerings) bySection.set(o.sectionId, [...(bySection.get(o.sectionId) ?? []), o]);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {[...bySection.values()].map((list) => {
        const first = list[0]!;
        const gaps = list.filter((o) => o.allocations.length === 0).length;
        return (
          <WidgetCard
            key={first.sectionId}
            title={`Section ${first.sectionLabel}`}
            description={`${first.batchCode} · ${list.length} courses${gaps ? ` · ${gaps} unallocated` : ""}`}
            action={
              <Link
                href={`/students?section=${first.sectionCode}`}
                className="text-brand text-xs font-medium hover:underline"
              >
                Students
              </Link>
            }
            flush
          >
            <ul className="divide-border divide-y">
              {list.map((o) => (
                <li key={o.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{o.courseName}</p>
                    <p className="text-2xs text-subtle">
                      <span className="font-mono">{o.courseCode}</span> · {o.credits} cr · {o.weeklyHours}{" "}
                      h/wk
                      {o.courseType !== "theory" && ` · ${o.courseType}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {o.allocations.length === 0 && (
                      <Badge tone="warning">
                        <AlertTriangle aria-hidden /> Unallocated
                      </Badge>
                    )}
                    {o.allocations.map((a) => (
                      <span
                        key={a.id}
                        className="bg-surface-muted inline-flex items-center gap-1 rounded-full py-0.5 pr-0.5 pl-2 text-xs"
                      >
                        <Link href={`/faculty/${a.userId}`} className="hover:text-brand">
                          {a.name}
                        </Link>
                        {a.role !== "primary" && (
                          <span className="text-subtle">({a.role.replace("_", "-")})</span>
                        )}
                        {o.canAllocate && (
                          <RemoveAllocationDialog
                            allocation={{
                              id: a.id,
                              name: a.name,
                              offeringLabel: `${o.courseCode} for ${o.sectionLabel}`,
                            }}
                          />
                        )}
                      </span>
                    ))}
                    {o.canAllocate && (
                      <AllocateDialog
                        offering={{
                          id: o.id,
                          label: `${o.courseCode} · ${o.sectionLabel}`,
                          weeklyHours: o.weeklyHours,
                        }}
                        exclude={o.allocations.map((a) => a.userId)}
                        homeDepartment={o.departmentCode}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </WidgetCard>
        );
      })}
    </div>
  );
}
