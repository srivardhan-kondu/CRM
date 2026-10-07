"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { applyLeaveAction } from "@/app/(app)/attendance/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError, useResultAction } from "@/components/ui/form";
import { Input, Label, Select } from "@/components/ui/input";

export function ApplyLeaveDialog({
  studentId,
  studentName,
  min,
  max,
}: {
  studentId: string;
  studentName: string;
  min: string;
  max: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useResultAction(applyLeaveAction, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Apply for leave
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Leave for ${studentName}`}
        description="On-duty leave (events, competitions) counts as present. Medical leave is excused from the total. The class incharge decides."
      >
        <form action={action} className="space-y-4">
          <input type="hidden" name="studentId" value={studentId} />
          <div className="space-y-1.5">
            <Label htmlFor="leave-kind">Type</Label>
            <Select id="leave-kind" name="kind" defaultValue="medical">
              <option value="medical">Medical leave</option>
              <option value="od">On duty (OD)</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="leave-from">From</Label>
              <Input id="leave-from" name="fromDate" type="date" min={min} max={max} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-to">To</Label>
              <Input id="leave-to" name="toDate" type="date" min={min} max={max} required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leave-reason">Reason</Label>
            <Input
              id="leave-reason"
              name="reason"
              required
              minLength={5}
              placeholder="e.g. Fever; doctor's note attached"
            />
          </div>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Send application
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
