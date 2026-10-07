"use client";

import { GraduationCap } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup } from "@/lib/navigation/nav";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./icons";

function matches(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The most specific item wins: /announcements/sent highlights "Announcements", not "Inbox". */
function activeHref(pathname: string, groups: NavGroup[]): string | undefined {
  return groups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => matches(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
}

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-1">
      <span className="bg-brand text-brand-foreground flex size-9 items-center justify-center rounded-lg">
        <GraduationCap aria-hidden weight="fill" className="size-5" />
      </span>
      <span className="text-lg font-semibold tracking-tight">CampusOS</span>
    </Link>
  );
}

export function NavList({
  groups,
  badges,
  onNavigate,
}: {
  groups: NavGroup[];
  badges?: Record<string, number>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-muted mb-1.5 px-3 text-xs font-semibold tracking-wide uppercase">
            {group.label}
          </p>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = item.href === current;
              const badge = badges?.[item.key];
              return (
                <li key={`${group.label}-${item.key}`}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
                      active
                        ? "bg-brand-soft text-brand-soft-foreground font-semibold"
                        : "text-foreground hover:bg-surface-muted",
                    )}
                  >
                    <Icon
                      aria-hidden
                      weight="duotone"
                      className={cn("size-[22px] shrink-0", active ? "text-brand" : "text-muted")}
                    />
                    <span className="truncate">{item.label}</span>
                    {badge ? (
                      <span
                        className="bg-brand text-brand-foreground tabular ml-auto min-w-6 rounded-full px-2 text-center text-xs leading-6 font-semibold"
                        aria-label={`${badge} new`}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ groups, badges }: { groups: NavGroup[]; badges?: Record<string, number> }) {
  return (
    <aside className="border-border bg-sidebar sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-16 items-center px-4">
        <Brand />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <NavList groups={groups} badges={badges} />
      </div>
      <div className="border-border text-muted border-t px-4 py-3 text-xs">Demo with made-up data</div>
    </aside>
  );
}
