"use client";

import { Check, Loader2, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError, useResultAction, type ResultState } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";

type Action = (prev: never, form: FormData) => Promise<ResultState>;

/** Approve directly; the other outcome (reject / return) asks for a note the requester will see. */
export function DecideWithNote({
  action,
  hidden,
  label,
  approve = { value: "approved", text: "Approve" },
  other = { value: "rejected", text: "Reject" },
}: {
  action: Action;
  hidden: Record<string, string>;
  label: string;
  approve?: { value: string; text: string };
  other?: { value: string; text: string };
}) {
  const [open, setOpen] = useState(false);
  const [approveState, approveAction, approving] = useResultAction(action, () => {});
  const [otherState, otherAction, sending] = useResultAction(action, () => setOpen(false));
  const fields = (decision: string) => (
    <>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="decision" value={decision} />
    </>
  );
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" aria-label={`${other.text} ${label}`}>
              <Undo2 /> {other.text}
            </Button>
          </DialogTrigger>
          <DialogContent title={`${other.text} ${label}?`} description="Your note is shown to the requester.">
            <form action={otherAction} className="space-y-4">
              {fields(other.value)}
              <div className="space-y-1.5">
                <Label htmlFor={`note-${label}`}>Note</Label>
                <textarea
                  id={`note-${label}`}
                  name="note"
                  required
                  minLength={3}
                  rows={3}
                  className="border-border bg-surface focus-visible:ring-brand w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                />
              </div>
              <FormError state={otherState} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" disabled={sending}>
                  {sending && <Loader2 className="animate-spin" />} {other.text}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <form action={approveAction}>
          {fields(approve.value)}
          <Button type="submit" size="sm" disabled={approving} aria-label={`${approve.text} ${label}`}>
            {approving ? <Loader2 className="animate-spin" /> : <Check />} {approve.text}
          </Button>
        </form>
      </div>
      <FormError state={approveState} />
    </div>
  );
}

/** A note-taking request form behind a button (condonation). */
export function RequestWithReason({
  action,
  hidden,
  trigger,
  title,
  description,
}: {
  action: Action;
  hidden: Record<string, string>;
  trigger: string;
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useResultAction(action, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <form action={formAction} className="space-y-4">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <div className="space-y-1.5">
            <Label htmlFor={`reason-${title}`}>Reason</Label>
            <textarea
              id={`reason-${title}`}
              name="reason"
              required
              minLength={10}
              rows={3}
              className="border-border bg-surface focus-visible:ring-brand w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </div>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Send
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Record a revalued mark (the higher of the two stands). */
export function RevalueForm({
  action,
  id,
  max,
  label,
}: {
  action: Action;
  id: string;
  max: number;
  label: string;
}) {
  const [state, formAction, pending] = useResultAction(action, () => {});
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <span className="inline-flex items-center gap-2">
        <Input
          name="revaluedSee"
          aria-label={`Revalued mark for ${label}`}
          inputMode="decimal"
          required
          className="h-8 w-20 text-right"
        />
        <span className="text-subtle text-xs">/ {max}</span>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Record
        </Button>
      </span>
      <FormError state={state} />
    </form>
  );
}
