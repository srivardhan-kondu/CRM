"use client";

import { Question } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { AskCampusOS } from "./ask";

/** "Ask a question" in the top bar: the assistant in a side sheet, from any page. */
export function AskButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="gap-2 px-3">
          <Question weight="duotone" className="text-brand size-6!" />
          <span className="hidden md:inline">Ask a question</span>
          <span className="sr-only md:hidden">Ask a question</span>
        </Button>
      </DialogTrigger>
      <SheetContent
        title="Ask a question"
        description="Type a question in your own words. Answers only use records you're allowed to see."
      >
        <div className="p-5">
          <AskCampusOS onNavigate={() => setOpen(false)} autoFocus />
        </div>
      </SheetContent>
    </Dialog>
  );
}
