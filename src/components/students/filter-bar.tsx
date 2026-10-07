"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { toSearchParams } from "@/domains/students/params";
import type { StudentQuery } from "@/domains/students/types";
import { cn } from "@/lib/utils";

export interface FilterOptions {
  departments: { value: string; label: string }[];
  years: number[];
  sections: { value: string; label: string }[];
  risk: boolean;
  fee: boolean;
  shortage: boolean;
}

export function StudentFilterBar({ query, options }: { query: StudentQuery; options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query.q ?? "");
  const [syncedQ, setSyncedQ] = useState(query.q);

  // Keep the input in step when the URL changes from elsewhere (saved views, back/forward).
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    if ((query.q ?? "") !== text.trim()) setText(query.q ?? "");
  }

  const push = (next: StudentQuery) => {
    const qs = toSearchParams({ ...next, page: undefined }).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // Debounced free-text search; the server does the filtering.
  useEffect(() => {
    if ((text.trim() || undefined) === query.q) return;
    const t = setTimeout(() => push({ ...query, q: text.trim() || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [text]);

  const active =
    !!query.q ||
    !!query.department ||
    !!query.year ||
    !!query.sectionId ||
    (!!query.risk && query.risk !== "any") ||
    !!query.fee ||
    !!query.shortage;

  return (
    <div className={cn("mb-3 flex flex-col gap-2 lg:flex-row lg:items-center", pending && "opacity-80")}>
      <div className="relative lg:w-80">
        <Search
          aria-hidden
          className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          aria-label="Search students"
          placeholder="Name, student ID, section or email"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {options.departments.length > 0 && (
          <Select
            aria-label="Department"
            className="w-auto"
            value={query.department ?? ""}
            onChange={(e) =>
              push({
                ...query,
                department: (e.target.value || undefined) as StudentQuery["department"],
                sectionId: undefined,
              })
            }
          >
            <option value="">All departments</option>
            {options.departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        )}
        {options.years.length > 1 && (
          <Select
            aria-label="Year"
            className="w-auto"
            value={query.year ?? ""}
            onChange={(e) =>
              push({
                ...query,
                year: e.target.value ? Number(e.target.value) : undefined,
                sectionId: undefined,
              })
            }
          >
            <option value="">All years</option>
            {options.years.map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </Select>
        )}
        {options.sections.length > 0 && (
          <Select
            aria-label="Section"
            className="w-auto"
            value={query.sectionId ?? ""}
            onChange={(e) => push({ ...query, sectionId: e.target.value || undefined })}
          >
            <option value="">All sections</option>
            {options.sections.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
        {options.risk && (
          <Select
            aria-label="Risk level"
            className="w-auto"
            value={query.risk ?? ""}
            onChange={(e) => push({ ...query, risk: (e.target.value || undefined) as StudentQuery["risk"] })}
          >
            <option value="">Any risk</option>
            <option value="high">High risk</option>
            <option value="watch">Watch</option>
            <option value="none">On track</option>
          </Select>
        )}
        {options.fee && (
          <Select
            aria-label="Fee status"
            className="w-auto"
            value={query.fee ?? ""}
            onChange={(e) => push({ ...query, fee: (e.target.value || undefined) as StudentQuery["fee"] })}
          >
            <option value="">Any fee status</option>
            <option value="paid">Paid</option>
            <option value="due">Due</option>
            <option value="overdue">Overdue</option>
          </Select>
        )}
        {options.shortage && (
          <label className="border-border bg-surface hover:border-border-strong flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm shadow-xs">
            <input
              type="checkbox"
              className="accent-[var(--brand)]"
              checked={!!query.shortage}
              onChange={(e) => push({ ...query, shortage: e.target.checked || undefined })}
            />
            Below 75%
          </label>
        )}
        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText("");
              push({ sort: query.sort, dir: query.dir });
            }}
          >
            <X /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}
