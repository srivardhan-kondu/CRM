"use client";

import { Check, Loader2, Undo2, X } from "lucide-react";
import { useState } from "react";
import { decideAction, withdrawAction } from "@/app/(app)/attendance/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError, useResultAction } from "@/components/ui/form";
import { Label } from "@/components/ui/input";

type ItemType = "attendance" | "leave";

export function WithdrawButton({ type, id }: { type: ItemType; id: string }) {
  const [state, action, pending] = useResultAction(withdrawAction, () => {});
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Undo2 />} Withdraw
      </Button>
      <FormError state={state} />
    </form>
  );
}

/** Approve straight away, or reject with a note the requester will see. */
export function DecideButtons({ type, id, label }: { type: ItemType; id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [approveState, approve, approving] = useResultAction(decideAction, () => {});
  const [rejectState, reject, rejecting] = useResultAction(decideAction, () => setOpen(false));
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" aria-label={`Reject ${label}`}>
              <X /> Reject
            </Button>
          </DialogTrigger>
          <DialogContent
            title={`Reject ${label}?`}
            description="The requester sees your note and can resubmit."
          >
            <form action={reject} className="space-y-4">
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="decision" value="rejected" />
              <div className="space-y-1.5">
                <Label htmlFor={`note-${id}`}>Note to the requester</Label>
                <textarea
                  id={`note-${id}`}
                  name="note"
                  required
                  minLength={3}
                  rows={3}
                  className="border-border bg-surface focus-visible:ring-brand w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                />
              </div>
              <FormError state={rejectState} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" disabled={rejecting}>
                  {rejecting && <Loader2 className="animate-spin" />} Reject
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <form action={approve}>
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="approved" />
          <Button type="submit" size="sm" disabled={approving} aria-label={`Approve ${label}`}>
            {approving ? <Loader2 className="animate-spin" /> : <Check />} Approve
          </Button>
        </form>
      </div>
      <FormError state={approveState} />
    </div>
  );
}
