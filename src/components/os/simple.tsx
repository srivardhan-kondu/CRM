import {
  CaretDown,
  CheckCircle,
  ClipboardText,
  Info,
  SealCheck,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { AttentionItem, Health, Priority, Pulse } from "@/domains/insights/attention";
import { PRIORITY_LABEL } from "@/domains/insights/attention";
import { cn } from "@/lib/utils";

/*
 * The simple home page, built for people who are not daily computer users: one sentence on how things are, a short
 * to-do list with one big button per item, a few large numbers, and everything else behind "Show more details".
 * Meaning is always in words and icons, never in colour alone.
 */

const PRIORITY: Record<Priority, { icon: Icon; circle: string; word: string }> = {
  critical: { icon: WarningCircle, circle: "bg-danger-soft text-danger", word: "text-danger" },
  action: { icon: ClipboardText, circle: "bg-brand-soft text-brand", word: "text-brand" },
  important: {
    icon: Warning,
    circle: "bg-warning-soft text-warning-soft-foreground",
    word: "text-warning-soft-foreground",
  },
  info: { icon: Info, circle: "bg-info-soft text-info-soft-foreground", word: "text-info-soft-foreground" },
};

const HEALTH: Record<Health, { icon: Icon; box: string; text: string }> = {
  good: { icon: SealCheck, box: "border-success/30 bg-success-soft", text: "text-success-soft-foreground" },
  watch: { icon: Warning, box: "border-warning/30 bg-warning-soft", text: "text-warning-soft-foreground" },
  critical: {
    icon: WarningCircle,
    box: "border-danger/30 bg-danger-soft",
    text: "text-danger-soft-foreground",
  },
};

/** How things are, in one sentence. */
export function HealthBanner({ pulse }: { pulse: Pulse }) {
  const h = HEALTH[pulse.status];
  const IconC = h.icon;
  return (
    <section
      aria-label="How things are"
      className={cn("flex items-start gap-4 rounded-xl border px-5 py-4", h.box)}
    >
      <IconC aria-hidden weight="fill" className={cn("mt-0.5 size-8 shrink-0", h.text)} />
      <p className={cn("text-lg leading-snug font-semibold", h.text)}>{pulse.headline}</p>
    </section>
  );
}

/** A few large numbers, each with a sentence saying what it means. */
export function Glance({
  items,
}: {
  items: { key: string; label: string; value: string; note: string; status?: Health; href?: string }[];
}) {
  return (
    <section
      aria-label="At a glance"
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2",
        items.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4",
      )}
    >
      {items.map((v) => {
        const word =
          v.status === "critical" ? "Needs attention" : v.status === "watch" ? "Keep an eye on it" : null;
        const body = (
          <>
            <p className="text-muted text-[15px] font-medium">{v.label}</p>
            <p className="tabular text-foreground mt-1 text-4xl font-semibold tracking-tight">{v.value}</p>
            <p className="text-muted mt-1.5 text-sm leading-snug">{v.note}</p>
            {word && (
              <p
                className={cn(
                  "mt-2 inline-flex items-center gap-1 text-sm font-semibold",
                  v.status === "critical" ? "text-danger" : "text-warning-soft-foreground",
                )}
              >
                <Warning aria-hidden weight="fill" className="size-4" /> {word}
              </p>
            )}
          </>
        );
        const cls = "border-border bg-surface block rounded-xl border px-5 py-4";
        return v.href ? (
          <Link key={v.key} href={v.href} className={cn(cls, "hover:border-brand/50 transition-colors")}>
            {body}
          </Link>
        ) : (
          <div key={v.key} className={cls}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

function TodoRow({ item }: { item: AttentionItem }) {
  const p = PRIORITY[item.priority];
  const IconC = p.icon;
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-full", p.circle)}>
        <IconC aria-hidden weight="duotone" className="size-7" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold", p.word)}>{PRIORITY_LABEL[item.priority]}</p>
        <p className="text-foreground text-[17px] leading-snug font-semibold">{item.title}</p>
        {item.detail && <p className="text-muted mt-0.5 text-[15px] leading-snug">{item.detail}</p>}
      </div>
      <Button
        asChild
        size="lg"
        variant={item.priority === "critical" ? "primary" : "secondary"}
        className="shrink-0"
      >
        <Link href={item.href}>{item.cta}</Link>
      </Button>
    </li>
  );
}

/** Everything that needs the person, most urgent first, one big button each. */
export function TodoList({ items, limit = 5 }: { items: AttentionItem[]; limit?: number }) {
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);
  return (
    <section aria-labelledby="todo-title" className="border-border bg-surface rounded-xl border">
      <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="todo-title" className="text-xl font-semibold">
          Your to-do list
        </h2>
        <span className="text-muted text-[15px]">
          {items.length === 0 ? "Nothing to do" : `${items.length} ${items.length === 1 ? "item" : "items"}`}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="flex items-center gap-4 px-5 py-8">
          <CheckCircle aria-hidden weight="duotone" className="text-success size-10" />
          <p className="text-[17px]">You&apos;re all done. Nothing needs you right now.</p>
        </div>
      ) : (
        <>
          <ul className="divide-border divide-y">
            {shown.map((i) => (
              <TodoRow key={i.id} item={i} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="group border-border border-t">
              <summary className="text-brand flex cursor-pointer list-none items-center justify-center gap-2 px-5 py-3.5 text-[15px] font-semibold">
                Show {rest.length} more{" "}
                <CaretDown
                  aria-hidden
                  weight="bold"
                  className="size-4 transition-transform group-open:rotate-180"
                />
              </summary>
              <ul className="divide-border divide-y border-t">
                {rest.map((i) => (
                  <TodoRow key={i.id} item={i} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/** Charts, lists and comparisons — available, but out of the way until someone wants them. */
export function MoreDetails({
  children,
  label = "Show more details",
  hint = "Charts, comparisons and full lists",
}: {
  children: ReactNode;
  label?: string;
  hint?: string;
}) {
  return (
    <details className="group">
      <summary className="border-border bg-surface text-foreground hover:border-brand/50 flex cursor-pointer list-none items-center justify-between rounded-xl border px-5 py-4 text-[17px] font-semibold transition-colors">
        <span>
          {label}
          <span className="text-muted block text-sm font-normal">{hint}</span>
        </span>
        <CaretDown
          aria-hidden
          weight="bold"
          className="text-muted size-5 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-5 space-y-5">{children}</div>
    </details>
  );
}

/** A plain section heading with an optional link. */
export function Section({
  title,
  href,
  linkLabel = "See all",
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-border bg-surface rounded-xl border">
      <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {href && (
          <Link href={href} className="text-brand text-[15px] font-semibold hover:underline">
            {linkLabel}
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
