"use client";

import { Loader2, Plus, UserMinus, UserPlus } from "lucide-react";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  addRegulationCourseAction,
  allocateFacultyAction,
  createCourseAction,
  createDraftAction,
  removeAllocationAction,
} from "@/app/(app)/academics/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormError, useResultAction } from "@/components/ui/form";
import { Input, Label, Select } from "@/components/ui/input";
import type { ActionResult } from "@/lib/audit/result";
import { cn } from "@/lib/utils";

/* ---------- Generic: run a server action from a button, optionally behind a confirmation ---------- */

export function ActionButton({
  run,
  children,
  confirm,
  variant = "secondary",
  size = "sm",
  className,
}: {
  run: () => Promise<ActionResult>;
  children: ReactNode;
  /** When set, the action asks first: { title, description, confirmLabel }. */
  confirm?: { title: string; description: string; confirmLabel: string };
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const go = () =>
    start(async () => {
      const r = await run();
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.error);
    });
  const button = (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      className={className}
      onClick={confirm ? () => setOpen(true) : go}
    >
      {pending && <Loader2 className="animate-spin" />} {children}
    </Button>
  );
  if (!confirm) return button;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {button}
      <DialogContent title={confirm.title} description={confirm.description}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant={variant === "danger" ? "danger" : "primary"} disabled={pending} onClick={go}>
            {pending && <Loader2 className="animate-spin" />} {confirm.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormFooter({ pending, label, onCancel }: { pending: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} {label}
      </Button>
    </div>
  );
}

/* ---------- Course catalogue ---------- */

export function NewCourseDialog({ owners }: { owners: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useResultAction(createCourseAction, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New course
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a course to the catalogue"
        description="Courses are shared across regulations. Credits and hours can't be edited once a regulation uses the course, so check them against the approved syllabus."
      >
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="c-code">Code</Label>
              <Input id="c-code" name="code" required placeholder="CS311" className="font-mono uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Title</Label>
              <Input id="c-name" name="name" required placeholder="Natural Language Processing" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-owner">Owned by</Label>
              <Select id="c-owner" name="ownerUnitId" required defaultValue={owners[0]?.id}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-type">Type</Label>
              <Select id="c-type" name="type" defaultValue="theory">
                <option value="theory">Theory</option>
                <option value="lab">Lab</option>
                <option value="project">Project</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(
              [
                ["credits", "Credits", 3],
                ["lectureHours", "Lecture h/wk", 3],
                ["tutorialHours", "Tutorial h/wk", 0],
                ["practicalHours", "Practical h/wk", 0],
              ] as const
            ).map(([name, label, value]) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={`c-${name}`}>{label}</Label>
                <Input
                  id={`c-${name}`}
                  name={name}
                  type="number"
                  min={0}
                  max={30}
                  required
                  defaultValue={value}
                />
              </div>
            ))}
          </div>
          <FormError state={state} />
          <FormFooter pending={pending} label="Add course" onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Regulations ---------- */

export function NewDraftDialog({
  sources,
  suggestedCode,
  suggestedYear,
}: {
  sources: { id: string; code: string }[];
  suggestedCode: string;
  suggestedYear: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useResultAction(createDraftAction, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus /> New regulation
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Start a new regulation"
        description="A new regulation starts as an editable copy of an existing one. Batches already admitted keep their own regulation."
      >
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-from">Copy from</Label>
              <Select id="r-from" name="fromCurriculumId" defaultValue={sources.at(-1)?.id}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-code">New code</Label>
              <Input
                id="r-code"
                name="code"
                required
                defaultValue={suggestedCode}
                className="font-mono uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-year">First batch</Label>
              <Input
                id="r-year"
                name="effectiveFromYear"
                type="number"
                required
                defaultValue={suggestedYear}
              />
            </div>
          </div>
          <FormError state={state} />
          <FormFooter pending={pending} label="Create draft" onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddRegulationCourse({
  curriculumId,
  semesters,
  courses,
}: {
  curriculumId: string;
  semesters: number;
  courses: { id: string; code: string; name: string }[];
}) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useResultAction(addRegulationCourseAction, () => setKey((k) => k + 1));
  return (
    <form key={key} action={action} className="space-y-2">
      <input type="hidden" name="curriculumId" value={curriculumId} />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto]">
        <Select name="courseId" required defaultValue="" aria-label="Course">
          <option value="" disabled>
            Add a course from the catalogue…
          </option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </Select>
        <Select name="semester" defaultValue="1" aria-label="Semester">
          {Array.from({ length: semesters }, (_, i) => (
            <option key={i} value={i + 1}>
              Semester {i + 1}
            </option>
          ))}
        </Select>
        <Select name="category" defaultValue="core" aria-label="Category">
          {["core", "elective", "lab", "project", "foundation"].map((c) => (
            <option key={c} value={c}>
              {c[0]!.toUpperCase() + c.slice(1)}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

/* ---------- Teaching allocation ---------- */

export interface Candidate {
  userId: string;
  name: string;
  departmentCode: string;
  designation: string;
  hours: number;
  maxWeeklyHours: number;
}

const CandidatesContext = createContext<Candidate[]>([]);

/** Supplies allocation candidates once per page instead of once per offering. */
export function CandidatesProvider({
  candidates,
  children,
}: {
  candidates: Candidate[];
  children: ReactNode;
}) {
  return <CandidatesContext.Provider value={candidates}>{children}</CandidatesContext.Provider>;
}

export function AllocateDialog({
  offering,
  exclude,
  homeDepartment,
}: {
  offering: { id: string; label: string; weeklyHours: number };
  /** Faculty already teaching this offering. */
  exclude: string[];
  homeDepartment: string;
}) {
  const all = useContext(CandidatesContext);
  const candidates = all.filter((c) => !exclude.includes(c.userId));
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useResultAction(allocateFacultyAction, () => setOpen(false));
  // Department colleagues first, least loaded first: the usual allocation choice is the obvious one.
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(b.departmentCode === homeDepartment) - Number(a.departmentCode === homeDepartment) ||
      a.hours - b.hours ||
      a.name.localeCompare(b.name),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <UserPlus /> Allocate
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Allocate ${offering.label}`}
        description={`${offering.weeklyHours} contact hours a week. Allocation gives the faculty member course-level access to this section's students.`}
      >
        <form action={action} className="space-y-4">
          <input type="hidden" name="offeringId" value={offering.id} />
          <div className="space-y-1.5">
            <Label htmlFor="al-user">Faculty member</Label>
            <Select id="al-user" name="userId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {sorted.map((c) => {
                const after = c.hours + offering.weeklyHours;
                return (
                  <option key={c.userId} value={c.userId}>
                    {c.name} · {c.departmentCode} · {c.hours}/{c.maxWeeklyHours} h
                    {after > c.maxWeeklyHours ? ` (→ ${after} h, over load)` : ""}
                  </option>
                );
              })}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="al-role">Role</Label>
            <Select id="al-role" name="role" defaultValue="primary">
              <option value="primary">Primary teacher</option>
              <option value="co_teacher">Co-teacher</option>
              <option value="lab">Lab instructor</option>
            </Select>
          </div>
          <FormError state={state} />
          <FormFooter pending={pending} label="Allocate" onCancel={() => setOpen(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveAllocationDialog({
  allocation,
  className,
}: {
  allocation: { id: string; name: string; offeringLabel: string };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useResultAction(removeAllocationAction, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${allocation.name}`}
          className={cn("size-7", className)}
        >
          <UserMinus />
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Remove ${allocation.name}?`}
        description={`They stop teaching ${allocation.offeringLabel} and lose course access to its students on their next request. The allocation stays in history.`}
      >
        <form action={action} className="space-y-4">
          <input type="hidden" name="allocationId" value={allocation.id} />
          <div className="space-y-1.5">
            <Label htmlFor="rm-reason">Reason</Label>
            <Input
              id="rm-reason"
              name="reason"
              required
              minLength={3}
              placeholder="e.g. Reassigned after load review"
            />
          </div>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Remove
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
