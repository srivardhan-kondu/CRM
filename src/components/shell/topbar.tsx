"use client";

import {
  Bell,
  Building2,
  Check,
  CheckSquare,
  ChevronDown,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  Layers,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { markNotificationsReadAction } from "@/app/(app)/announcements/actions";
import { AskButton } from "@/components/assistant/ask-button";
import { signOut, switchTenant, switchWorkspace } from "@/app/actions/session";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, Kbd } from "@/components/ui/misc";
import type { AcademicContext } from "@/domains/org/types";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

export interface TopbarNotice {
  id: string;
  title: string;
  meta: string;
  urgent: boolean;
  unread: boolean;
}

/** A personal notification: a decision on your request, a reply to your message. */
export interface TopbarAlert {
  id: string;
  title: string;
  meta: string;
  href: string | null;
  unread: boolean;
}

export interface TopbarTask {
  id: string;
  title: string;
  meta: string;
  overdue: boolean;
}

export interface WorkspaceOption {
  id: string;
  role: string;
  scope: string;
  active: boolean;
}

export interface TenantOption {
  id: string;
  name: string;
  active: boolean;
}

interface Props {
  user: { name: string; email: string; roleLabel: string; scopeLabel: string };
  context: AcademicContext;
  workspaces: WorkspaceOption[];
  tenants: TenantOption[];
  notices: TopbarNotice[];
  alerts: TopbarAlert[];
  unreadAlerts: number;
  tasks: TopbarTask[] | null;
}

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function ThemeMenu() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("campusos-theme") as Theme | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage after mount
      if (stored) setTheme(stored);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const choose = (t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem("campusos-theme", t);
    } catch {
      /* storage unavailable */
    }
    applyTheme(t);
  };
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-40">
        {(
          [
            ["light", "Light", Sun],
            ["dark", "Dark", Moon],
            ["system", "System", Monitor],
          ] as const
        ).map(([key, label, I]) => (
          <DropdownMenuItem key={key} onSelect={() => choose(key)}>
            <I /> {label}
            {theme === key && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ user, context, workspaces, tenants, notices, alerts, unreadAlerts, tasks }: Props) {
  const { setPaletteOpen, setMobileNavOpen } = useShell();
  const urgent = notices.filter((n) => n.urgent && n.unread).length;
  const newCount = unreadAlerts + notices.filter((n) => n.unread).length;

  return (
    <header className="border-border bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 border-b backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu />
        </Button>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="border-border bg-surface text-subtle hover:border-border-strong flex h-9 w-full max-w-md items-center gap-2 rounded-md border px-3 text-sm shadow-xs transition-colors"
        >
          <Search aria-hidden className="size-4" />
          <span className="truncate">
            <span className="hidden sm:inline">Search students, pages and actions…</span>
            <span className="sm:hidden">Search…</span>
          </span>
          <span className="ml-auto hidden items-center gap-0.5 sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1">
          <AskButton />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hidden gap-1.5 md:inline-flex"
                aria-label="Institution and academic year"
              >
                <Building2 />
                <span className="text-foreground max-w-48 truncate">{context.institution}</span>
                <span className="text-subtle">·</span>
                <span>AY {context.academicYear}</span>
                <ChevronDown className="size-3.5!" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
              <DropdownMenuLabel>Institution</DropdownMenuLabel>
              {tenants.map((t) =>
                t.active ? (
                  <DropdownMenuItem key={t.id}>
                    <Check /> {t.name}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={t.id} onSelect={() => void switchTenant(t.id)}>
                    <span className="size-4" /> {t.name}
                  </DropdownMenuItem>
                ),
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Current term</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/academics">
                  <Check /> {context.term}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <p className="text-2xs text-subtle px-2 py-1.5">
                Academic pages can show other terms with their term picker. The current term is set in
                Academics.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>

          {tasks && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Approvals, ${tasks.length} pending`}
                  className="relative"
                >
                  <CheckSquare />
                  {tasks.length > 0 && (
                    <span className="bg-brand text-brand-foreground tabular absolute top-1 right-1 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
                      {tasks.length}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-80">
                <DropdownMenuLabel>Pending approvals</DropdownMenuLabel>
                {tasks.length === 0 && (
                  <p className="text-muted px-2 py-3 text-sm">Nothing waiting on you.</p>
                )}
                {tasks.map((t) => (
                  <div key={t.id} className="rounded-md px-2 py-1.5">
                    <p className="text-foreground text-sm">{t.title}</p>
                    <p className={cn("text-2xs", t.overdue ? "text-danger" : "text-subtle")}>{t.meta}</p>
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/approvals">Open approvals</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <DropdownMenu
            onOpenChange={(open) => {
              // Opening the bell is reading it: personal notifications are marked read when it closes.
              if (!open && unreadAlerts > 0) void markNotificationsReadAction();
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Notifications, ${newCount} new`}
                className="relative"
              >
                <Bell />
                {newCount > 0 && (
                  <span
                    className={cn(
                      "tabular absolute top-1 right-1 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                      urgent > 0 ? "bg-danger" : "bg-brand",
                    )}
                  >
                    {newCount > 9 ? "9+" : newCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80">
              {alerts.length > 0 && (
                <>
                  <DropdownMenuLabel>For you</DropdownMenuLabel>
                  {alerts.map((n) => (
                    <DropdownMenuItem key={n.id} asChild>
                      <Link href={n.href ?? "#"} className="items-start!">
                        <span
                          className={cn(
                            "mt-1.5 size-1.5 shrink-0 rounded-full",
                            n.unread ? "bg-brand" : "bg-transparent",
                          )}
                        />
                        <span className="min-w-0">
                          <span className={cn("line-clamp-2 block text-sm", n.unread && "font-medium")}>
                            {n.title}
                          </span>
                          <span className="text-2xs text-subtle line-clamp-2 block">{n.meta}</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel>Notices today</DropdownMenuLabel>
              {notices.length === 0 && (
                <p className="text-muted px-2 py-3 text-sm">You&apos;re all caught up.</p>
              )}
              {notices.map((n) => (
                <DropdownMenuItem key={n.id} asChild>
                  <Link href={`/announcements?view=important&id=${n.id}`} className="items-start!">
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        n.urgent ? "bg-danger" : n.unread ? "bg-brand" : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0">
                      <span className={cn("line-clamp-2 block text-sm", n.unread && "font-medium")}>
                        {n.title}
                      </span>
                      <span className="text-2xs text-subtle block">{n.meta}</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/announcements">Open announcements</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ThemeMenu />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hover:bg-surface-muted ml-1 flex items-center gap-2 rounded-md p-1"
                aria-label={`Account: ${user.name}`}
              >
                <Avatar name={user.name} size="sm" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
              <div className="flex items-center gap-3 px-2 py-2">
                <Avatar name={user.name} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="text-muted truncate text-xs">{user.email}</p>
                </div>
              </div>
              <div className="bg-surface-muted text-2xs text-muted mx-2 mb-1 rounded-md px-2 py-1.5">
                <span className="text-foreground font-medium">{user.roleLabel}</span> · Scope:{" "}
                {user.scopeLabel}
              </div>
              {workspaces.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
                  {workspaces.map((w) => (
                    <DropdownMenuItem
                      key={w.id}
                      onSelect={() => {
                        if (!w.active) void switchWorkspace(w.id);
                      }}
                    >
                      {w.active ? <Check /> : <Layers />}
                      <span className="min-w-0">
                        <span className="block truncate">{w.role}</span>
                        <span className="text-2xs text-subtle block truncate">{w.scope}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOut()}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
