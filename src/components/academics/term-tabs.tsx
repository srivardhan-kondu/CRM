import Link from "next/link";
import { cn } from "@/lib/utils";

/** Term switcher for academic pages: links that keep the page's other parameters. */
export function TermTabs({
  terms,
  active,
  href,
}: {
  terms: { code: string; name: string; isCurrent: boolean }[];
  active: string | undefined;
  href: (code: string) => string;
}) {
  if (terms.length < 2) return null;
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Term">
      {terms.map((t) => (
        <Link
          key={t.code}
          role="tab"
          aria-selected={t.code === active}
          href={href(t.code)}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
            t.code === active
              ? "bg-surface text-foreground ring-border shadow-xs ring-1"
              : "text-muted hover:bg-surface-muted hover:text-foreground",
          )}
        >
          {t.name}
          {t.isCurrent && <span className="text-2xs text-brand ml-1.5">current</span>}
        </Link>
      ))}
    </div>
  );
}

export function RegulationStatus({ status }: { status: "draft" | "active" | "retired" }) {
  const tone = {
    draft: "bg-warning-soft text-warning-soft-foreground",
    active: "bg-success-soft text-success-soft-foreground",
    retired: "bg-surface-muted text-muted",
  }[status];
  const label = { draft: "Draft", active: "Active", retired: "Retired" }[status];
  return <span className={cn("text-2xs rounded-full px-2 py-0.5 font-medium", tone)}>{label}</span>;
}

/** Meter tone for teaching load against a weekly cap. */
export function loadTone(hours: number, cap: number) {
  return hours > cap ? "danger" : hours >= cap * 0.85 ? "warning" : hours === 0 ? "brand" : "success";
}
