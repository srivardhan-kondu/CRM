import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { StudentFilterBar, type FilterOptions } from "@/components/students/filter-bar";
import { StudentTable } from "@/components/students/student-table";
import { parseStudentQuery, studentsHref, type RawSearchParams } from "@/domains/students/params";
import { toStudentRow } from "@/domains/students/projection";
import { columnsFor, queryVisible } from "@/domains/students/query";
import { directoryFacets, linkedStudents } from "@/domains/students/repository";
import type { StudentQuery } from "@/domains/students/types";
import { workspaceFor } from "@/lib/authz/catalogue";
import { requireAuth } from "@/lib/authz/context";
import { cn, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Students" };

interface PresetView {
  key: string;
  label: string;
  query: StudentQuery;
  requires?: "risk" | "finance" | "academic";
}

const PRESETS: PresetView[] = [
  { key: "all", label: "All students", query: {} },
  {
    key: "shortage",
    label: "Attendance shortage",
    query: { shortage: true, sort: "attendance" },
    requires: "academic",
  },
  { key: "risk", label: "High risk", query: { risk: "high", sort: "attendance" }, requires: "risk" },
  { key: "fees", label: "Fees overdue", query: { fee: "overdue" }, requires: "finance" },
];

function presetMatches(p: PresetView, q: StudentQuery): boolean {
  const norm = (x: StudentQuery) => ({ s: !!x.shortage, r: x.risk ?? null, f: x.fee ?? null });
  const a = norm(p.query);
  const b = norm(q);
  return a.s === b.s && a.r === b.r && a.f === b.f && !q.q && !q.department && !q.year && !q.sectionId;
}

export default async function StudentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const authed = await requireAuth();
  const workspace = authed.ctx.active ? workspaceFor(authed.ctx.active.roleKey) : "operations";
  if (workspace === "self" || workspace === "guardian") {
    const own = (await linkedStudents(authed, workspace === "self" ? "self" : "guardian"))[0];
    redirect(own ? `/students/${own.student.id}` : "/dashboard");
  }

  const { visible, departments, sections } = await directoryFacets(authed);
  // Columns, filters and saved views appear only for field classes readable on at least one row; the query
  // layer additionally ignores per-row values the viewer can't read, so filters can't infer hidden data.
  const fields = columnsFor(visible);
  const query = parseStudentQuery(await searchParams);
  if (!fields.finance) delete query.fee;
  if (!fields.risk) delete query.risk;
  if (!fields.academic) {
    delete query.shortage;
    if (query.sort === "attendance" || query.sort === "cgpa") delete query.sort;
  }

  const page = queryVisible(visible, query);
  const rows = page.rows.map((v) => toStudentRow(v.student, v.access));
  const inScope = visible.map((v) => v.student);

  const options: FilterOptions = {
    departments:
      departments.size > 1
        ? [...departments.keys()].sort().map((code) => ({ value: code, label: code }))
        : [],
    years: [...new Set(inScope.map((s) => s.year))].sort(),
    sections:
      sections.size > 1
        ? [...sections.entries()]
            .filter(
              ([, s]) =>
                (!query.department || s.departmentCode === query.department) &&
                (!query.year || s.year === query.year),
            )
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([code, s]) => ({ value: code, label: s.label }))
        : [],
    risk: fields.risk,
    fee: fields.finance,
    shortage: fields.academic,
  };

  const title =
    workspace === "department" ? "Department students" : workspace === "class" ? "My class" : "Students";

  return (
    <>
      <PageHeader
        title={title}
        description={`${formatNumber(inScope.length)} students you can open across your roles`}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Students" }]}
      />

      <div className="mb-3 flex gap-1 overflow-x-auto" role="tablist" aria-label="Saved views">
        {PRESETS.filter((p) => !p.requires || fields[p.requires]).map((p) => {
          const active = presetMatches(p, query);
          return (
            <Link
              key={p.key}
              role="tab"
              aria-selected={active}
              href={studentsHref(p.query)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "bg-surface text-foreground ring-border shadow-xs ring-1"
                  : "text-muted hover:bg-surface-muted hover:text-foreground",
              )}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      <StudentFilterBar query={query} options={options} />
      <StudentTable
        rows={rows}
        query={query}
        page={{ page: page.page, pageCount: page.pageCount, total: page.total, pageSize: page.pageSize }}
        columns={{
          academic: fields.academic,
          risk: fields.risk,
          finance: fields.finance,
          contact: fields.contact,
        }}
      />
    </>
  );
}
