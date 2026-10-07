"use client";

import { ArrowRightLeft, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { transferStudentAction, updateStudentAction } from "@/app/(app)/students/[id]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError, useResultAction } from "@/components/ui/form";
import { Input, Label, Select } from "@/components/ui/input";
import type { StudentStatus } from "@/domains/students/types";

interface Props {
  student: {
    id: string;
    name: string;
    email: string;
    phone: string;
    status: StudentStatus;
    hosteller: boolean;
    sectionLabel: string;
  };
  /** Same-batch sections the viewer may move this student into. */
  sections: { id: string; label: string }[];
}

const STATUSES: { value: StudentStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "detained", label: "Detained" },
  { value: "graduated", label: "Graduated" },
  { value: "withdrawn", label: "Withdrawn" },
];

/** Record maintenance for holders of student:manage. Both actions are authorized and audited on the server. */
export function ManageStudent({ student, sections }: Props) {
  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      <EditRecord student={student} />
      <MoveSection student={student} sections={sections} />
    </div>
  );
}

function EditRecord({ student }: Pick<Props, "student">) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useResultAction(updateStudentAction, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Pencil /> Edit record
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Edit ${student.name}`}
        description="Changes are recorded in the audit log with their previous values."
      >
        <form action={action} className="space-y-4">
          <input type="hidden" name="studentId" value={student.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="st-email">Email</Label>
              <Input id="st-email" name="email" type="email" required defaultValue={student.email} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-phone">Phone</Label>
              <Input id="st-phone" name="phone" required defaultValue={student.phone} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-status">Status</Label>
              <Select id="st-status" name="status" defaultValue={student.status}>
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                name="hosteller"
                defaultChecked={student.hosteller}
                className="accent-[var(--brand)]"
              />
              Hostel resident
            </label>
          </div>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveSection({ student, sections }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useResultAction(transferStudentAction, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" disabled={sections.length === 0}>
          <ArrowRightLeft /> Move section
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Move ${student.name}`}
        description={`Currently in ${student.sectionLabel}. Moves stay within the batch, and the reason is kept on the record.`}
      >
        <form action={action} className="space-y-4">
          <input type="hidden" name="studentId" value={student.id} />
          <div className="space-y-1.5">
            <Label htmlFor="mv-section">New section</Label>
            <Select id="mv-section" name="toSectionId" required defaultValue="">
              <option value="" disabled>
                Choose a section
              </option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mv-reason">Reason</Label>
            <Input
              id="mv-reason"
              name="reason"
              required
              minLength={5}
              placeholder="e.g. Elective group rebalancing"
            />
          </div>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Move student
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
