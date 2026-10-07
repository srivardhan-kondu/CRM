"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return <DialogPrimitive.Overlay className="bg-overlay animate-fade-in fixed inset-0 z-50" />;
}

export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: ReactNode;
  description?: ReactNode;
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "border-border bg-surface animate-scale-in fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-xl border shadow-lg focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-muted mt-1 text-sm">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {!hideClose && (
            <DialogPrimitive.Close className="text-muted hover:bg-surface-muted hover:text-foreground -m-1 rounded-md p-1">
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="px-5 pt-4 pb-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Side drawer: keeps the parent list in context while showing a record. */
export function SheetContent({
  className,
  children,
  title,
  description,
  side = "right",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: ReactNode;
  description?: ReactNode;
  side?: "right" | "left";
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "bg-surface fixed inset-y-0 z-50 flex w-full flex-col shadow-lg focus:outline-none",
          side === "right"
            ? "border-border animate-slide-in-right right-0 max-w-xl border-l"
            : "border-border animate-slide-in-left left-0 max-w-72 border-r",
          className,
        )}
        {...props}
      >
        <div className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-muted mt-0.5 text-sm">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">Details panel</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="text-muted hover:bg-surface-muted hover:text-foreground -m-1 rounded-md p-1">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
