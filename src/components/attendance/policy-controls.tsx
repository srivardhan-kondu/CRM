"use client";

import { Loader2 } from "lucide-react";
import {
  declareHolidayAction,
  setInstitutionThresholdAction,
  setProgrammeThresholdAction,
} from "@/app/(app)/attendance/actions";
import { Button } from "@/components/ui/button";
import { FormError, useResultAction } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/input";

export function InstitutionThresholdForm({ value }: { value: number }) {
  const [state, action, pending] = useResultAction(setInstitutionThresholdAction, () => {});
  return (
    <form action={action} className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="inst-threshold">Institution threshold (%)</Label>
          <Input
            id="inst-threshold"
            name="thresholdPct"
            type="number"
            min={50}
            max={100}
            defaultValue={value}
            className="w-24"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

export function ProgrammeThresholdForm({
  programmeId,
  code,
  value,
}: {
  programmeId: string;
  code: string;
  value: number | null;
}) {
  const [state, action, pending] = useResultAction(setProgrammeThresholdAction, () => {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="programmeId" value={programmeId} />
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${code} threshold (%)`}
          name="thresholdPct"
          type="number"
          min={50}
          max={100}
          defaultValue={value ?? ""}
          placeholder="Default"
          className="h-8 w-24"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={`Save ${code} threshold`}
        >
          {pending ? <Loader2 className="animate-spin" /> : "Save"}
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}

export function DeclareHolidayForm({ min, max }: { min: string; max: string }) {
  const [state, action, pending] = useResultAction(declareHolidayAction, () => {});
  return (
    <form action={action} className="space-y-2">
      <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="holiday-date">Date</Label>
          <Input id="holiday-date" name="date" type="date" min={min} max={max} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="holiday-name">Occasion</Label>
          <Input
            id="holiday-name"
            name="name"
            required
            minLength={3}
            placeholder="e.g. Heavy rain advisory"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Declare holiday
        </Button>
      </div>
      <FormError state={state} />
    </form>
  );
}
