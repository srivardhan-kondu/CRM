"use client";

import { Command } from "cmdk";
import { CornerDownLeft, Loader2, LogOut, Search, UserRound, UserRoundCog } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "@/app/actions/session";
import type { SearchResult } from "@/app/api/search/route";
import { Kbd } from "@/components/ui/misc";
import type { NavItem } from "@/lib/navigation/nav";
import { NAV_ICONS } from "./icons";
import { useShell } from "./shell-context";

function Item({
  children,
  onSelect,
  value,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  value: string;
  disabled?: boolean;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      disabled={disabled}
      className="text-foreground data-[selected=true]:bg-surface-muted [&_svg]:text-muted flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm select-none data-[disabled=true]:opacity-50 [&_svg]:size-4"
    >
      {children}
    </Command.Item>
  );
}

const groupClass =
  "px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase";

export function CommandPalette({ nav, canSearchStudents }: { nav: NavItem[]; canSearchStudents: boolean }) {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!paletteOpen || !canSearchStudents || q.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (res.ok) setStudents(((await res.json()) as { students: SearchResult[] }).students);
      } catch {
        /* aborted or offline — keep previous results */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, paletteOpen, canSearchStudents]);

  const go = (href: string) => {
    setPaletteOpen(false);
    router.push(href);
  };

  const onOpenChange = (open: boolean) => {
    setPaletteOpen(open);
    if (!open) {
      setQuery("");
      setStudents([]);
    }
  };

  const showStudents = canSearchStudents && query.trim().length >= 2;

  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-overlay animate-fade-in fixed inset-0 z-50" />
        <DialogPrimitive.Content className="border-border bg-surface animate-scale-in fixed top-[10vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border shadow-lg focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search students, open pages and run actions.
          </DialogPrimitive.Description>
          <Command label="Command palette" shouldFilter loop>
            <div className="border-border flex items-center gap-2 border-b px-3">
              {loading ? (
                <Loader2 className="text-subtle size-4 animate-spin" />
              ) : (
                <Search className="text-subtle size-4" />
              )}
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={
                  canSearchStudents
                    ? "Search students by name or ID, or jump to a page…"
                    : "Jump to a page or run an action…"
                }
                className="placeholder:text-subtle h-12 w-full bg-transparent text-sm outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1">
              <Command.Empty className="text-muted px-3 py-8 text-center text-sm">
                {loading ? "Searching…" : "No matches in your scope."}
              </Command.Empty>

              {showStudents && students.length > 0 && (
                <Command.Group heading="Students" className={groupClass}>
                  {students.map((s) => (
                    <Item
                      key={s.id}
                      value={`student ${s.name} ${s.studentNumber} ${s.sectionLabel} ${query}`}
                      onSelect={() => go(`/students/${s.id}`)}
                    >
                      <UserRound />
                      <span className="truncate">{s.name}</span>
                      <span className="text-2xs text-subtle ml-auto font-mono">
                        {s.studentNumber} · {s.sectionLabel}
                      </span>
                    </Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Go to" className={groupClass}>
                {nav.map((item) => {
                  const Icon = NAV_ICONS[item.icon];
                  return (
                    <Item
                      key={`${item.key}-${item.href}`}
                      value={`go ${item.label}`}
                      onSelect={() => go(item.href)}
                    >
                      <Icon />
                      {item.label}
                      {!item.available && (
                        <span className="text-2xs text-subtle ml-auto">Phase {item.phase}</span>
                      )}
                    </Item>
                  );
                })}
              </Command.Group>

              <Command.Group heading="Account" className={groupClass}>
                <Item value="switch demo account persona role" onSelect={() => go("/login")}>
                  <UserRoundCog /> Switch demo account
                </Item>
                <Item
                  value="sign out log out"
                  onSelect={() => {
                    setPaletteOpen(false);
                    void signOut();
                  }}
                >
                  <LogOut /> Sign out
                </Item>
              </Command.Group>
            </Command.List>
            <div className="border-border text-2xs text-subtle flex items-center gap-3 border-t px-3 py-2">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>
                  <CornerDownLeft className="size-3" />
                </Kbd>
                open
              </span>
              <span className="ml-auto">Results are limited to your access scope</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
