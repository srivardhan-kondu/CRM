"use client";

import { Dialog, SheetContent } from "@/components/ui/dialog";
import type { NavGroup } from "@/lib/navigation/nav";
import { useShell } from "./shell-context";
import { NavList } from "./sidebar";

export function MobileNav({ groups, badges }: { groups: NavGroup[]; badges?: Record<string, number> }) {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  return (
    <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent side="left" title="CampusOS" description="Navigation">
        <div className="px-3 py-4">
          <NavList groups={groups} badges={badges} onNavigate={() => setMobileNavOpen(false)} />
        </div>
      </SheetContent>
    </Dialog>
  );
}
