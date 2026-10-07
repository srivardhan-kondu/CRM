import { UserX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/patterns/states";
import { Button } from "@/components/ui/button";

export default function StudentNotFound() {
  return (
    <EmptyState
      icon={UserX}
      title="Student not found"
      description="This record doesn't exist or isn't within your access scope."
      action={
        <Button asChild variant="secondary">
          <Link href="/students">Back to students</Link>
        </Button>
      }
      className="py-24"
    />
  );
}
