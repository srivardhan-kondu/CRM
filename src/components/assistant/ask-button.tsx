"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { AskCampusOS } from "./ask";

/** "Ask CampusOS" in the top bar: the assistant in a side sheet, from any page. */
export function AskButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Sparkles className="text-brand" />
          <span className="hidden md:inline">Ask CampusOS</span>
          <span className="sr-only md:hidden">Ask CampusOS</span>
        </Button>
      </DialogTrigger>
      <SheetContent
        title="Ask CampusOS"
        description="Answers from the records you're allowed to see, with links to them."
      >
        <div className="p-5">
          <AskCampusOS onNavigate={() => setOpen(false)} autoFocus />
        </div>
      </SheetContent>
    </Dialog>
  );
}
