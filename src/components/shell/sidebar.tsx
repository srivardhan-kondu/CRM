"use client";

import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavGroup, NavItem } from "@/lib/navigation/nav";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./icons";

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-1">
      <span className="bg-brand text-brand-foreground flex size-7 items-center justify-center rounded-md">
        <GraduationCap aria-hidden className="size-4" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">CampusOS</span>
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
  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-2xs text-subtle mb-1 px-2 font-medium tracking-wide uppercase">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = isActive(pathname, item);
              const badge = badges?.[item.key];
              return (
                <li key={`${group.label}-${item.key}`}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                      active
                        ? "bg-surface text-foreground ring-border font-medium shadow-xs ring-1"
                        : "text-muted hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-brand" : "text-subtle group-hover:text-muted",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                    {!item.available ? (
                      <span
                        className="text-2xs text-subtle ml-auto rounded px-1"
                        title={`Arrives in Phase ${item.phase}`}
                      >
                        P{item.phase}
                      </span>
                    ) : badge ? (
                      <span className="bg-brand text-2xs text-brand-foreground tabular ml-auto rounded-full px-1.5 font-semibold">
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
    <aside className="border-border bg-sidebar sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r lg:flex">
      <div className="flex h-14 items-center px-4">
        <Brand />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <NavList groups={groups} badges={badges} />
      </div>
      <div className="border-border text-2xs text-subtle border-t px-4 py-3">
        Phase 1 · Synthetic demo data
      </div>
    </aside>
  );
}
