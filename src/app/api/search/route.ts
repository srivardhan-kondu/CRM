import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { searchStudents } from "@/domains/students/repository";
import { currentAuth } from "@/lib/authz/context";

const querySchema = z.object({ q: z.string().trim().min(1).max(100) });

export interface SearchResult {
  id: string;
  name: string;
  studentNumber: string;
  sectionLabel: string;
}

/** Permission-aware global search. Results are scope-filtered on the server before they leave it. */
export async function GET(request: NextRequest) {
  const authed = await currentAuth();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse({ q: request.nextUrl.searchParams.get("q") ?? "" });
  if (!parsed.success) return NextResponse.json({ students: [] });

  const students: SearchResult[] = (await searchStudents(authed, parsed.data.q)).map((s) => ({
    id: s.id,
    name: s.name,
    studentNumber: s.studentNumber,
    sectionLabel: s.sectionLabel,
  }));
  return NextResponse.json({ students }, { headers: { "Cache-Control": "private, no-store" } });
}
