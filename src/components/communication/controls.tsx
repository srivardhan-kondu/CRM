"use client";

import { Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError, useResultAction, type ResultState } from "@/components/ui/form";
import { Label } from "@/components/ui/input";

type Action = (prev: never, form: FormData) => Promise<ResultState>;

export const textareaClass =
  "border-border bg-surface focus-visible:ring-brand w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

function Hidden({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

/** One-click action (acknowledge, save, remind, recall…) with its error shown inline. */
export function ActionButton({
  action,
  hidden,
  children,
  icon,
  variant,
  size = "sm",
  label,
}: {
  action: Action;
  hidden: Record<string, string>;
  children: ReactNode;
  icon?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  label?: string;
}) {
  const [state, formAction, pending] = useResultAction(action, () => {});
  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <Hidden fields={hidden} />
      <Button type="submit" size={size} variant={variant} disabled={pending} aria-label={label}>
        {pending ? <Loader2 className="animate-spin" /> : icon} {children}
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** An action that needs a written reason (withdraw a notice), behind a button. */
export function ReasonDialog({
  action,
  hidden,
  trigger,
  title,
  description,
  field = "reason",
  fieldLabel = "Reason",
  submit,
  minLength = 5,
  danger,
}: {
  action: Action;
  hidden: Record<string, string>;
  trigger: ReactNode;
  title: string;
  description: string;
  field?: string;
  fieldLabel?: string;
  submit: string;
  minLength?: number;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useResultAction(action, () => setOpen(false));
  const id = `${field}-${Object.values(hidden).join("-")}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <form action={formAction} className="space-y-4">
          <Hidden fields={hidden} />
          <div className="space-y-1.5">
            <Label htmlFor={id}>{fieldLabel}</Label>
            <textarea
              id={id}
              name={field}
              required={minLength > 0}
              minLength={minLength}
              rows={3}
              className={textareaClass}
            />
          </div>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} {submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
