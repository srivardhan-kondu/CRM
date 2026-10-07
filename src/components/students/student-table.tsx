"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Download,
  ExternalLink,
  MessageSquare,
  SearchX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AttendanceValue, FeeBadge, RiskBadge, StudentStatusBadge } from "@/components/patterns/status";
import { EmptyState } from "@/components/patterns/states";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Avatar, Meter } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { studentsHref } from "@/domains/students/params";
import type { StudentRow } from "@/domains/students/projection";
import type { StudentQuery, StudentSort } from "@/domains/students/types";
import { cn, formatINR, formatNumber } from "@/lib/utils";

interface Columns {
  academic: boolean;
  risk: boolean;
  finance: boolean;
  contact: boolean;
}

interface PageInfo {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}

function SortHeader({
  label,
  sort,
  query,
  className,
}: {
  label: string;
  sort: StudentSort;
  query: StudentQuery;
  className?: string;
}) {
  const current = (query.sort ?? "number") === sort;
  const dir = current ? (query.dir ?? "asc") : undefined;
  const next: StudentQuery = {
    ...query,
    sort,
    dir: current && dir === "asc" ? "desc" : "asc",
    page: undefined,
  };
  const Icon = !current ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={current ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2 font-medium", className)}
    >
      <Link
        href={studentsHref(next)}
        scroll={false}
        className="hover:text-foreground inline-flex items-center gap-1"
      >
        {label}
        <Icon aria-hidden className={cn("size-3", !current && "opacity-50")} />
      </Link>
    </th>
  );
}

export function StudentTable({
  rows,
  query,
  page,
  columns,
}: {
  rows: StudentRow[];
  query: StudentQuery;
  page: PageInfo;
  columns: Columns;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<StudentRow | null>(null);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyIds = async () => {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.studentNumber);
    try {
      await navigator.clipboard.writeText(ids.join("\n"));
      toast.success(`Copied ${ids.length} student ID${ids.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Clipboard is unavailable in this browser.");
    }
  };

  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.total, page.page * page.pageSize);

  return (
    <div className="border-border bg-surface rounded-lg border shadow-xs">
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="border-border bg-brand-soft/60 flex flex-wrap items-center gap-2 border-b px-3 py-2"
        >
          <span className="text-brand-soft-foreground text-sm font-medium">{selected.size} selected</span>
          <Button variant="secondary" size="sm" onClick={copyIds}>
            <Copy /> Copy IDs
          </Button>
          <Tooltip content="Messaging selected students arrives with the Communication Hub in Phase 5">
            <span>
              <Button variant="secondary" size="sm" disabled>
                <MessageSquare /> Message
              </Button>
            </span>
          </Tooltip>
          <Tooltip content="Exports need a separate export permission and are audited — Phase 1">
            <span>
              <Button variant="secondary" size="sm" disabled>
                <Download /> Export
              </Button>
            </span>
          </Tooltip>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X /> Clear
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No students match these filters"
          description="Try removing a filter or searching by student ID. Results only include students within your access scope."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/students">Reset filters</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr className="border-border text-2xs text-subtle border-b text-left tracking-wide uppercase">
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={toggleAll}
                    className="accent-[var(--brand)]"
                  />
                </th>
                <SortHeader label="Student" sort="name" query={query} />
                <SortHeader label="ID" sort="number" query={query} className="hidden md:table-cell" />
                <th scope="col" className="px-3 py-2 font-medium">
                  Section
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">
                  Status
                </th>
                {columns.academic && (
                  <SortHeader label="Attendance" sort="attendance" query={query} className="text-right" />
                )}
                {columns.academic && (
                  <SortHeader
                    label="CGPA"
                    sort="cgpa"
                    query={query}
                    className="hidden text-right sm:table-cell"
                  />
                )}
                {columns.risk && (
                  <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                    Risk
                  </th>
                )}
                {columns.finance && (
                  <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">
                    Fees
                  </th>
                )}
                <th scope="col" className="hidden px-3 py-2 font-medium xl:table-cell">
                  Mentor
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  onClick={() => setPreview(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setPreview(r);
                  }}
                  aria-selected={selected.has(r.id)}
                  className={cn(
                    "hover:bg-surface-muted focus-visible:bg-surface-muted cursor-pointer outline-none",
                    selected.has(r.id) && "bg-brand-soft/40",
                  )}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="accent-[var(--brand)]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.name} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="text-2xs text-subtle truncate md:hidden">{r.studentNumber}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-muted hidden px-3 py-2 font-mono text-xs md:table-cell">
                    {r.studentNumber}
                  </td>
                  <td className="text-muted px-3 py-2 text-xs whitespace-nowrap">{r.sectionLabel}</td>
                  <td className="hidden px-3 py-2 lg:table-cell">
                    <StudentStatusBadge status={r.status} />
                  </td>
                  {columns.academic && (
                    <td className="px-3 py-2 text-right">
                      {r.attendancePct !== undefined && (
                        <AttendanceValue pct={r.attendancePct} threshold={r.attendanceThreshold} />
                      )}
                    </td>
                  )}
                  {columns.academic && (
                    <td className="tabular hidden px-3 py-2 text-right sm:table-cell">
                      {r.cgpa ? r.cgpa.toFixed(2) : "—"}
                    </td>
                  )}
                  {columns.risk && (
                    <td className="hidden px-3 py-2 md:table-cell">
                      {r.risk && <RiskBadge level={r.risk.level} />}
                    </td>
                  )}
                  {columns.finance && (
                    <td className="hidden px-3 py-2 lg:table-cell">
                      {r.feeStatus && <FeeBadge status={r.feeStatus} />}
                    </td>
                  )}
                  <td className="text-muted hidden px-3 py-2 text-xs xl:table-cell">{r.mentorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav
        aria-label="Pagination"
        className="border-border text-muted flex items-center justify-between gap-3 border-t px-3 py-2 text-xs"
      >
        <span className="tabular">
          {formatNumber(from)}–{formatNumber(to)} of {formatNumber(page.total)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            asChild={page.page > 1}
            variant="ghost"
            size="icon-sm"
            disabled={page.page <= 1}
            aria-label="Previous page"
          >
            {page.page > 1 ? (
              <Link href={studentsHref({ ...query, page: page.page - 1 })} scroll={false}>
                <ChevronLeft />
              </Link>
            ) : (
              <ChevronLeft />
            )}
          </Button>
          <span className="tabular px-1">
            Page {page.page} of {page.pageCount}
          </span>
          <Button
            asChild={page.page < page.pageCount}
            variant="ghost"
            size="icon-sm"
            disabled={page.page >= page.pageCount}
            aria-label="Next page"
          >
            {page.page < page.pageCount ? (
              <Link href={studentsHref({ ...query, page: page.page + 1 })} scroll={false}>
                <ChevronRight />
              </Link>
            ) : (
              <ChevronRight />
            )}
          </Button>
        </div>
      </nav>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && (
          <SheetContent
            title={preview.name}
            description={`${preview.studentNumber} · ${preview.programme} · ${preview.sectionLabel}`}
          >
            <StudentPreview row={preview} />
          </SheetContent>
        )}
      </Dialog>
    </div>
  );
}

function StudentPreview({ row }: { row: StudentRow }) {
  return (
    <div className="space-y-5 p-5">
      <div className="flex items-center gap-3">
        <Avatar name={row.name} size="lg" />
        <div className="flex flex-wrap gap-1.5">
          <StudentStatusBadge status={row.status} />
          {row.risk && <RiskBadge level={row.risk.level} />}
          {row.feeStatus && <FeeBadge status={row.feeStatus} />}
        </div>
      </div>

      {row.attendancePct !== undefined && (
        <dl className="grid grid-cols-3 gap-3">
          <div className="bg-surface-muted rounded-md p-3">
            <dt className="text-2xs text-muted">Attendance</dt>
            <dd className="mt-0.5 text-lg font-semibold">
              <AttendanceValue pct={row.attendancePct} threshold={row.attendanceThreshold} />
            </dd>
          </div>
          <div className="bg-surface-muted rounded-md p-3">
            <dt className="text-2xs text-muted">CGPA</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold">{row.cgpa ? row.cgpa.toFixed(2) : "—"}</dd>
          </div>
          <div className="bg-surface-muted rounded-md p-3">
            <dt className="text-2xs text-muted">Credits</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold">
              {row.creditsEarned}
              <span className="text-subtle text-xs font-normal">/{row.creditsRequired}</span>
            </dd>
          </div>
        </dl>
      )}
      {row.creditsEarned !== undefined && row.creditsRequired !== undefined && (
        <Meter value={(row.creditsEarned / row.creditsRequired) * 100} label="Credit progress" />
      )}

      {row.risk && row.risk.factors.length > 0 && (
        <section>
          <h3 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Why flagged</h3>
          <ul className="space-y-2">
            {row.risk.factors.map((f) => (
              <li key={f.key} className="border-border rounded-md border p-3">
                <p className="text-sm font-medium">{f.label}</p>
                <p className="text-muted text-xs">{f.detail}</p>
                <p className="text-2xs text-subtle mt-1">Rule: {f.threshold}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 text-sm">
        <dt className="text-muted">Semester</dt>
        <dd>{row.semester}</dd>
        <dt className="text-muted">Mentor</dt>
        <dd>{row.mentorName}</dd>
        {row.email && (
          <>
            <dt className="text-muted">Email</dt>
            <dd className="truncate">{row.email}</dd>
          </>
        )}
        {row.feeDue !== undefined && row.feeDue > 0 && (
          <>
            <dt className="text-muted">Outstanding</dt>
            <dd className="tabular">{formatINR(row.feeDue)}</dd>
          </>
        )}
      </dl>

      <Button asChild className="w-full">
        <Link href={`/students/${row.id}`}>
          Open Student 360 <ExternalLink />
        </Link>
      </Button>
    </div>
  );
}
