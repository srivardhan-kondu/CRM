"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ShellState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen((o) => !o);
      return;
    }
    const target = e.target as HTMLElement | null;
    const typing =
      target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    if (e.key === "/" && !typing) {
      e.preventDefault();
      setPaletteOpen(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const value = useMemo(
    () => ({ paletteOpen, setPaletteOpen, mobileNavOpen, setMobileNavOpen }),
    [paletteOpen, mobileNavOpen],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}
