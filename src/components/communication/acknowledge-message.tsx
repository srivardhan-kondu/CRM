"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { acknowledgeMessageAction } from "@/app/(app)/announcements/actions";
import { Button } from "@/components/ui/button";
import { FormError, useResultAction } from "@/components/ui/form";
import { Label } from "@/components/ui/input";
import { textareaClass } from "./controls";

/** A guardian acknowledges a message, optionally with a short reply to the sender. */
export function AcknowledgeMessage({ id }: { id: string }) {
  const [state, action, pending] = useResultAction(acknowledgeMessageAction, () => {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Label htmlFor={`reply-${id}`}>Reply (optional)</Label>
      <textarea id={`reply-${id}`} name="reply" rows={2} maxLength={500} className={textareaClass} />
      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Acknowledge
        </Button>
      </div>
    </form>
  );
}
