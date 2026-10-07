"use client";

import { Send } from "lucide-react";
import { dispatchNowAction } from "@/app/(app)/announcements/actions";
import { ActionButton } from "./controls";

export function DispatchButton({ due }: { due: number }) {
  return (
    <ActionButton action={dispatchNowAction} hidden={{}} icon={<Send />} size="md">
      Release {due} due now
    </ActionButton>
  );
}
