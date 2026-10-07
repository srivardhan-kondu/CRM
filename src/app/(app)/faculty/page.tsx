import { AlertTriangle, Gauge, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { loadTone, TermTabs } from "@/components/academics/term-tabs";
import { WidgetCard } from "@/components/dashboard/widgets";
import { InsightCard } from "@/components/patterns/insight-card";
import { PageHeader } from "@/components/patterns/page-header";
import { PermissionState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { Avatar, Meter } from "@/components/ui/misc";
import { listFaculty, termContext } from "@/domains/academics/repository";
import type { FacultyRow } from "@/domains/academics/load";
import { requireAuth } from "@/lib/authz/context";

export const metadata: Metadata = { title: "Faculty" };

export default async function FacultyPage({ searchParams }: { searchParams: Promise<{ term?: string }> }) {
  const authed = await requireAuth();
  const { term: code } = await searchParams;
  const { terms, term } = await termContext(authed, code);
  const faculty = await listFaculty(authed, term?.id ?? null);
  if (!faculty) {
    return (
      <div className="border-border bg-surface rounded-lg border py-12 shadow-xs">
        <PermissionState description="Faculty profiles and teaching load aren't part of your role." />
      </div>
    );
  }

  const over = faculty.filter((f) => f.hours > f.maxWeeklyHours);
  const idle = faculty.filter((f) => f.status === "active" && f.hours === 0);
  const byDept = new Map<string, FacultyRow[]>();
  for (const f of faculty) byDept.set(f.departmentCode, [...(byDept.get(f.departmentCode) ?? []), f]);

  return (
    <>
      <PageHeader
        title="Faculty"
        description="Teaching load against each member's weekly contact-hour cap, from current allocations."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Faculty" }]}
      />
      <TermTabs terms={terms} active={term?.code} href={(c) => `/faculty?term=${c}`} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InsightCard
          icon={Users}
          label="Faculty in scope"
          value={faculty.length}
          context={`${byDept.size} departments`}
          definition="Faculty whose home department you oversee"
        />
        <InsightCard
          icon={AlertTriangle}
          label="Over their cap"
          value={over.length}
          context={
            over.length
              ? over
                  .map((f) => f.name)
                  .slice(0, 2)
                  .join(", ")
              : "No one is overloaded"
          }
          definition="Weekly contact hours above the member's planned maximum"
          tone={over.length ? "danger" : "success"}
        />
        <InsightCard
          icon={Gauge}
          label="Without teaching"
          value={idle.length}
          context={term ? term.name : "No term"}
          definition="Active faculty with no allocation in the selected term"
          tone={idle.length ? "warning" : "neutral"}
        />
      </div>
      <div className="space-y-5">
        {[...byDept.entries()].map(([dept, list]) => (
          <WidgetCard key={dept} title={list[0]!.departmentName} description={`${list.length} faculty`} flush>
            <ul className="divide-border divide-y">
              {list.map((f) => (
                <li key={f.userId}>
                  <Link
                    href={`/faculty/${f.userId}${code ? `?term=${code}` : ""}`}
                    className="hover:bg-surface-muted flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3 sm:w-80">
                      <Avatar name={f.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{f.name}</p>
                        <p className="text-2xs text-subtle truncate">
                          {f.designation} · <span className="font-mono">{f.employeeCode}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-1 items-center gap-3">
                      <Meter
                        value={(f.hours / f.maxWeeklyHours) * 100}
                        tone={loadTone(f.hours, f.maxWeeklyHours)}
                        label={`${f.name} teaching load`}
                        className="max-w-60"
                      />
                      <span className="tabular text-muted w-20 shrink-0 text-xs">
                        {f.hours}/{f.maxWeeklyHours} h/wk
                      </span>
                      {f.hours > f.maxWeeklyHours && <Badge tone="danger">Over cap</Badge>}
                      {f.status !== "active" && <Badge tone="neutral">{f.status.replace("_", " ")}</Badge>}
                    </div>
                    <span className="text-muted text-xs sm:w-28 sm:text-right">
                      {f.teaching.length} offering{f.teaching.length === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </WidgetCard>
        ))}
      </div>
    </>
  );
}
