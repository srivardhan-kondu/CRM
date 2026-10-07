"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { inviteUserAction, type FormState } from "./actions";

export function InviteUserButton() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(inviteUserAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- close after a successful submit
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Invite user
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Invite a user"
        description="They sign in with the Google account for this exact email. Inviting gives no access until you grant a role."
      >
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Full name</Label>
            <Input id="invite-name" name="name" required minLength={2} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="name@college.edu.in"
            />
          </div>
          {state && !state.ok && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm"
            >
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Invite
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
