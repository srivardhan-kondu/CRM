import "server-only";

import { cache } from "react";
import { getDb } from "@/db/client";
import type { AcademicContext } from "@/domains/org/types";
import { loadCurrentTerm } from "@/domains/students/load";
import type { AuthContext } from "@/lib/authz/types";

/** The tenant's current term, loaded once per request. */
export const getCurrentTerm = cache((tenantId: string) => loadCurrentTerm(getDb(), tenantId));

/** Institution, academic year and term shown in the shell — from the database, not a fixture. */
export async function academicContext(ctx: AuthContext): Promise<AcademicContext> {
  const term = await getCurrentTerm(ctx.tenantId);
  return {
    institution: ctx.tenantName,
    academicYear: term ? term.academicYearCode.replace("-", "–") : "Not set",
    term: term?.name ?? "No current term",
  };
}
