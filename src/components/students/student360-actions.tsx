"use client";

import { Copy, FileText, HeartHandshake, Inbox, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { WorkspaceKind } from "@/lib/authz/catalogue";

interface PlannedAction {
  label: string;
  icon: typeof Copy;
  phase: number;
  workspaces: WorkspaceKind[];
}

const PLANNED: PlannedAction[] = [
  {
    label: "Message",
    icon: MessageSquare,
    phase: 5,
    workspaces: ["admin", "leadership", "department", "class", "teaching"],
  },
  {
    label: "Create intervention",
    icon: HeartHandshake,
    phase: 6,
    workspaces: ["leadership", "department", "class"],
  },
  { label: "Generate document", icon: FileText, phase: 7, workspaces: ["admin", "leadership", "department"] },
  { label: "Raise request", icon: Inbox, phase: 7, workspaces: ["self", "guardian"] },
];

export function Student360Actions({
  studentNumber,
  workspace,
}: {
  studentNumber: string;
  workspace: WorkspaceKind;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(studentNumber);
      toast.success(`Copied ${studentNumber}`);
    } catch {
      toast.error("Clipboard is unavailable in this browser.");
    }
  };
  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      <Button variant="secondary" size="sm" onClick={copy}>
        <Copy /> Copy ID
      </Button>
      {PLANNED.filter((a) => a.workspaces.includes(workspace)).map(({ label, icon: Icon, phase }) => (
        <Tooltip key={label} content={`Arrives in Phase ${phase}`}>
          <span>
            <Button variant="secondary" size="sm" disabled>
              <Icon /> {label}
            </Button>
          </span>
        </Tooltip>
      ))}
    </div>
  );
}
