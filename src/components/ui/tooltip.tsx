"use client";

import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="bg-foreground text-background animate-fade-in z-50 max-w-64 rounded-md px-2 py-1 text-xs shadow-md"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
