import { Skeleton } from "@/components/ui/misc";

/** Default loading state for every page in the app shell: a header and content blocks. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-xl" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
