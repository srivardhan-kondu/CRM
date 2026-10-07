"use client";

import { AlertOctagon, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { EmptyState } from "@/components/patterns/states";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="border-border bg-surface rounded-lg border py-10 shadow-xs">
      <EmptyState
        icon={AlertOctagon}
        title="Something went wrong loading this page"
        description={
          <>
            Your data is safe — nothing was changed. Try again, and if it keeps happening share this reference
            with support: <code className="font-mono text-xs">{error.digest ?? "unavailable"}</code>
          </>
        }
        action={
          <Button variant="secondary" onClick={reset}>
            <RotateCcw /> Try again
          </Button>
        }
      />
    </div>
  );
}
