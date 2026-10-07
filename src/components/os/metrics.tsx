import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Info,
  Minus,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import type { Health, Pulse } from "@/domains/insights/attention";
import { cn } from "@/lib/utils";

const HEALTH = {
  good: {
    icon: CheckCircle2,
    label: "Good",
    text: "text-success-soft-foreground",
    dot: "bg-success",
    soft: "bg-success-soft",
  },
  watch: {
    icon: TriangleAlert,
    label: "Watch",
    text: "text-warning-soft-foreground",
    dot: "bg-warning",
    soft: "bg-warning-soft",
  },
  critical: {
    icon: OctagonAlert,
    label: "Needs attention",
    text: "text-danger",
    dot: "bg-danger",
    soft: "bg-danger-soft",
  },
} as const satisfies Record<Health, unknown>;

export function HealthTag({ status, className }: { status: Health; className?: string }) {
  const h = HEALTH[status];
  const Icon = h.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", h.text, className)}>
      <Icon aria-hidden className="size-3.5" /> {h.label}
    </span>
  );
}

/**
 * Campus health in one glance: a verdict sentence and four vitals, each judged against a stated threshold. Built so a
 * principal can answer "how is the campus?" in ten seconds.
 */
export function CampusPulse({ pulse, title = "Campus health" }: { pulse: Pulse; title?: string }) {
  const h = HEALTH[pulse.status];
  const Icon = h.icon;
  return (
    <section aria-labelledby="pulse-title" className="border-border bg-surface rounded-lg border">
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span
          className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", h.soft, h.text)}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id="pulse-title" className="text-muted text-xs font-semibold tracking-wide uppercase">
            {title} · <span className={h.text}>{h.label}</span>
          </h2>
          <p className="text-foreground mt-0.5 text-[15px] leading-snug font-medium">{pulse.headline}</p>
        </div>
      </div>
      <dl className="border-border grid grid-cols-2 border-t lg:grid-cols-4">
        {pulse.vitals.map((v, i) => {
          const vh = HEALTH[v.status];
          const body = (
            <>
              <dt className="text-muted flex items-center gap-1.5 text-xs">
                <span aria-hidden className={cn("size-2 rounded-full", vh.dot)} />
                {v.label}
                <span className="sr-only">: {vh.label}</span>
              </dt>
              <dd className="tabular text-foreground mt-1 text-2xl font-semibold tracking-tight">
                {v.value}
              </dd>
              <dd className="text-subtle mt-0.5 text-xs leading-snug">{v.note}</dd>
            </>
          );
          return (
            <div
              key={v.key}
              className={cn(
                "border-border px-5 py-3.5",
                i % 2 === 1 && "border-l",
                i >= 2 && "border-t lg:border-t-0",
                i >= 1 && "lg:border-l",
              )}
            >
              {v.href ? (
                <Link href={v.href} className="block hover:opacity-80">
                  {body}
                </Link>
              ) : (
                body
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/**
 * One key metric: value, what it means, and how it is defined (tooltip). Status is shown by an icon and text, never by
 * colour alone. Dashboards show at most four.
 */
export function MetricCard({
  label,
  value,
  context,
  definition,
  status,
  href,
}: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  definition: string;
  status?: Health;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted inline-flex items-center gap-1 text-xs font-medium">
          {label}
          <Tooltip content={definition}>
            <span tabIndex={0} aria-label={`How ${label} is defined: ${definition}`} className="text-subtle">
              <Info aria-hidden className="size-3" />
            </span>
          </Tooltip>
        </span>
        {status && status !== "good" && <HealthTag status={status} />}
      </div>
      <p className="tabular text-foreground mt-2 text-[26px] leading-none font-semibold tracking-tight">
        {value}
      </p>
      <p className="text-muted mt-1.5 text-xs">{context}</p>
    </>
  );
  const cls = "border-border bg-surface block rounded-lg border px-4 py-3.5";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-border-strong transition-colors")}>
      {content}
    </Link>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/**
 * Inline SVG sparkline with an optional threshold line, scaled to the data (and threshold) so week-to-week movement is
 * visible. Decorative: the card states the numbers in text.
 */
function Sparkline({ values, threshold }: { values: number[]; threshold?: number }) {
  const span = [...values, ...(threshold !== undefined ? [threshold] : [])];
  const min = Math.floor(Math.min(...span) - 2);
  const max = Math.min(100, Math.ceil(Math.max(...span) + 2));
  const w = 240;
  const h = 56;
  const y = (v: number) => h - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * h;
  const x = (i: number) => (values.length <= 1 ? w : (i / (values.length - 1)) * w);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-14 w-full overflow-visible"
      aria-hidden
    >
      {threshold !== undefined && (
        <line
          x1="0"
          x2={w}
          y1={y(threshold)}
          y2={y(threshold)}
          className="stroke-border-strong"
          strokeDasharray="4 4"
        />
      )}
      <path
        d={d}
        fill="none"
        className="stroke-brand"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {values.length > 0 && (
        <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r="3" className="fill-brand" />
      )}
    </svg>
  );
}

/** A metric over time: current value, change on the previous period, the line, and its definition. */
export function TrendCard({
  title,
  points,
  unit = "%",
  threshold,
  definition,
  href,
}: {
  title: string;
  points: { label: string; value: number }[];
  unit?: string;
  threshold?: number;
  definition: string;
  href?: string;
}) {
  const last = points.at(-1);
  const prev = points.at(-2);
  const delta = last && prev ? last.value - prev.value : null;
  const Arrow = delta === null || Math.abs(delta) < 0.05 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <section className="border-border bg-surface rounded-lg border px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
        {href && (
          <Link href={href} className="text-brand text-xs font-medium hover:underline">
            Details
          </Link>
        )}
      </div>
      {last ? (
        <>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="tabular text-foreground text-[26px] leading-none font-semibold tracking-tight">
              {last.value.toFixed(1)}
              {unit}
            </span>
            {delta !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-medium",
                  delta < -0.05
                    ? "text-danger"
                    : delta > 0.05
                      ? "text-success-soft-foreground"
                      : "text-muted",
                )}
              >
                <Arrow aria-hidden className="size-3.5" />
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)} pts on last week
              </span>
            )}
          </div>
          <div className="mt-3">
            <Sparkline values={points.map((p) => p.value)} threshold={threshold} />
          </div>
          <div className="text-subtle mt-1 flex justify-between text-[11px]">
            <span>{points[0]!.label}</span>
            {threshold !== undefined && <span>Dashed line: {threshold}% requirement</span>}
            <span>{last.label}</span>
          </div>
        </>
      ) : (
        <p className="text-muted mt-3 text-sm">Not enough data yet.</p>
      )}
      <p className="text-subtle mt-2 text-[11px]">{definition}</p>
    </section>
  );
}
