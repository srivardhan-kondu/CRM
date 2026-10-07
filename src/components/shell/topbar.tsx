"use client";

import {
  Bell,
  Buildings,
  Check,
  List,
  MagnifyingGlass,
  Moon,
  Question,
  SignOut,
  Sun,
  TextAa,
  UserSwitch,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useEffect, useState } from "react";
import { markNotificationsReadAction } from "@/app/(app)/announcements/actions";
import { signOut, switchTenant, switchWorkspace } from "@/app/actions/session";
import { AskButton } from "@/components/assistant/ask-button";
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
  /** Approvals are reached from the sidebar (with a count); kept for callers that still pass them. */
  tasks?: TopbarTask[] | null;
}

/** Display preferences, stored per browser: light or dark, normal or large text. */
function usePreference(key: string, fallback: string, apply: (value: string) => void) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage after mount
      if (stored) setValue(stored);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const choose = (v: string) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* storage unavailable */
    }
    apply(v);
  };
  return [value, choose] as const;
}

/**
 * The top bar keeps four things: search, "Ask a question", notifications and the account menu. Everything else
 * (switching role or institution, text size, light or dark) lives in the account menu, named in plain words.
 */
export function Topbar({ user, context, workspaces, tenants, notices, alerts, unreadAlerts }: Props) {
  const { setPaletteOpen, setMobileNavOpen } = useShell();
  const urgent = notices.filter((n) => n.urgent && n.unread).length;
  const newCount = unreadAlerts + notices.filter((n) => n.unread).length;
  const [theme, setTheme] = usePreference("campusos-theme", "light", (v) =>
    document.documentElement.classList.toggle("dark", v === "dark"),
  );
  const [textSize, setTextSize] = usePreference("campusos-text", "normal", (v) =>
    document.documentElement.classList.toggle("text-large", v === "large"),
  );

  return (
    <header className="border-border bg-surface sticky top-0 z-30 border-b">
      <div className="flex h-16 items-center gap-2 px-4 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open menu"
          onClick={() => setMobileNavOpen(true)}
        >
          <List weight="bold" />
        </Button>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="border-border bg-background text-muted hover:border-border-strong flex h-11 w-full max-w-md items-center gap-2.5 rounded-lg border px-3.5 text-[15px] transition-colors"
        >
          <MagnifyingGlass aria-hidden weight="bold" className="size-5" />
          <span className="truncate">
            <span className="hidden sm:inline">Search for a student, page or task…</span>
            <span className="sm:hidden">Search…</span>
          </span>
          <span className="ml-auto hidden items-center gap-0.5 md:flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <AskButton />

          <DropdownMenu
            onOpenChange={(open) => {
              // Opening the bell is reading it: personal notifications are marked read when it closes.
              if (!open && unreadAlerts > 0) void markNotificationsReadAction();
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative gap-2 px-3"
                aria-label={`Notifications, ${newCount} new`}
              >
                <Bell weight="duotone" className="size-6!" />
                <span className="hidden xl:inline">Notifications</span>
                {newCount > 0 && (
                  <span
                    className={cn(
                      "tabular flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white",
                      urgent > 0 ? "bg-danger" : "bg-brand",
                    )}
                  >
                    {newCount > 9 ? "9+" : newCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-96 max-w-[calc(100vw-2rem)]">
              {alerts.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-sm">For you</DropdownMenuLabel>
                  {alerts.map((n) => (
                    <DropdownMenuItem key={n.id} asChild>
                      <Link href={n.href ?? "#"} className="items-start! py-2.5">
                        <span
                          className={cn(
                            "mt-2 size-2 shrink-0 rounded-full",
                            n.unread ? "bg-brand" : "bg-transparent",
                          )}
                        />
                        <span className="min-w-0">
                          <span className={cn("line-clamp-2 block text-[15px]", n.unread && "font-semibold")}>
                            {n.title}
                          </span>
                          <span className="text-muted line-clamp-2 block text-sm">{n.meta}</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel className="text-sm">Notices for today</DropdownMenuLabel>
              {notices.length === 0 && (
                <p className="text-muted px-2 py-3 text-[15px]">Nothing new. You&apos;re all caught up.</p>
              )}
              {notices.map((n) => (
                <DropdownMenuItem key={n.id} asChild>
                  <Link href={`/announcements?view=important&id=${n.id}`} className="items-start! py-2.5">
                    <span
                      className={cn(
                        "mt-2 size-2 shrink-0 rounded-full",
                        n.urgent ? "bg-danger" : n.unread ? "bg-brand" : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0">
                      <span className={cn("line-clamp-2 block text-[15px]", n.unread && "font-semibold")}>
                        {n.title}
                      </span>
                      <span className="text-muted block text-sm">{n.meta}</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/announcements" className="text-brand py-2.5 font-medium">
                  See all notices
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hover:bg-surface-muted flex items-center gap-2 rounded-lg py-1.5 pr-2 pl-1.5"
                aria-label={`Your account: ${user.name}`}
              >
                <Avatar name={user.name} size="sm" />
                <span className="hidden text-left leading-tight lg:block">
                  <span className="block max-w-40 truncate text-sm font-medium">{user.name}</span>
                  <span className="text-muted block max-w-40 truncate text-xs">{user.roleLabel}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80">
              <div className="px-2 py-2">
                <p className="truncate text-[15px] font-semibold">{user.name}</p>
                <p className="text-muted truncate text-sm">{user.email}</p>
                <p className="text-muted mt-1 text-sm">
                  {user.roleLabel} · {user.scopeLabel}
                </p>
                <p className="text-muted text-sm">
                  {context.institution} · {context.term}
                </p>
              </div>

              {workspaces.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-sm">Switch role</DropdownMenuLabel>
                  {workspaces.map((w) => (
                    <DropdownMenuItem
                      key={w.id}
                      className="py-2"
                      onSelect={() => {
                        if (!w.active) void switchWorkspace(w.id);
                      }}
                    >
                      {w.active ? <Check weight="bold" /> : <UserSwitch weight="duotone" />}
                      <span className="min-w-0">
                        <span className="block truncate">{w.role}</span>
                        <span className="text-muted block truncate text-xs">{w.scope}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {tenants.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-sm">Switch institution</DropdownMenuLabel>
                  {tenants.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      className="py-2"
                      onSelect={() => {
                        if (!t.active) void switchTenant(t.id);
                      }}
                    >
                      {t.active ? <Check weight="bold" /> : <Buildings weight="duotone" />} {t.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-sm">Display</DropdownMenuLabel>
              <DropdownMenuItem
                className="py-2"
                onSelect={(e) => {
                  e.preventDefault();
                  setTextSize(textSize === "large" ? "normal" : "large");
                }}
              >
                <TextAa weight="duotone" />
                {textSize === "large" ? "Use normal text size" : "Use larger text"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="py-2"
                onSelect={(e) => {
                  e.preventDefault();
                  setTheme(theme === "dark" ? "light" : "dark");
                }}
              >
                {theme === "dark" ? <Sun weight="duotone" /> : <Moon weight="duotone" />}
                {theme === "dark" ? "Use light colours" : "Use dark colours"}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="py-2">
                <Link href="/insights">
                  <Question weight="duotone" /> Help — ask a question
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="py-2" onSelect={() => void signOut()}>
                <SignOut weight="duotone" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
