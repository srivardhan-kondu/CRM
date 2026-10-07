import { Skeleton } from "@/components/ui/misc";

/** Mirrors the home layout (health, attention beside quick actions, trends) so nothing jumps when data arrives. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading your home page" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-36" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.7fr_1fr]">
        <Skeleton className="h-72" />
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
