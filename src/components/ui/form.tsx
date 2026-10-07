"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

export type ResultState = { ok: true; message: string } | { ok: false; error: string } | null;

/**
 * `useActionState` for a server action returning a result: toasts success as soon as the action resolves, then runs
 * `onSuccess` (e.g. close the dialog). The toast fires inside the action rather than in an effect, because a
 * successful action revalidates the page and can unmount the control that ran it (removing the row it lived in),
 * and an effect on an unmounted component never runs.
 */
export function useResultAction(
  // The previous state is passed through untouched, so any action's own state type fits.
  serverAction: (prev: never, form: FormData) => Promise<ResultState>,
  onSuccess: () => void,
) {
  const [state, action, pending] = useActionState<ResultState, FormData>(async (prev, form) => {
    const result = await serverAction(prev as never, form);
    if (result?.ok) toast.success(result.message);
    return result;
  }, null);
  useEffect(() => {
    if (state?.ok) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new results only
  }, [state]);
  return [state, action, pending] as const;
}

/** Inline error for a failed action, announced to assistive technology. */
export function FormError({ state }: { state: ResultState }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm">
      {state.error}
    </p>
  );
}
