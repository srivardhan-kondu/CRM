"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";

/** Context selector: which part of the hierarchy the dashboard describes (only units in the viewer's scope). */
export function ScopeSelect({
  options,
  value,
}: {
  options: { code: string; label: string }[];
  value: string;
}) {
  const router = useRouter();
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      Showing
      <Select
        aria-label="Dashboard scope"
        value={value}
        onChange={(e) => router.push(`/dashboard?scope=${encodeURIComponent(e.target.value)}`)}
        className="h-11 w-auto min-w-64 text-[15px]"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
