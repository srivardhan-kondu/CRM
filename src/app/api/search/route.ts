import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentTerm } from "@/domains/academics/context";
import { listCourses, listFaculty } from "@/domains/academics/repository";
import { listInbox } from "@/domains/announcements/repository";
import { parseIntent } from "@/domains/assistant/intents";
import { searchStudents } from "@/domains/students/repository";
import { currentAuth } from "@/lib/authz/context";
import { coversUnit } from "@/lib/authz/engine";
import { sectionLabel } from "@/lib/utils";

const querySchema = z.object({ q: z.string().trim().min(1).max(100) });

export interface SearchResult {
  id: string;
  name: string;
  studentNumber: string;
  sectionLabel: string;
}

export interface SearchHit {
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

export interface SearchResponse {
  students: SearchResult[];
  faculty: SearchHit[];
  courses: SearchHit[];
  notices: SearchHit[];
  units: SearchHit[];
  /** A natural-language question CampusOS can answer ("students below 75% attendance"). */
  question: { text: string; href: string } | null;
}

const LIMIT = 5;
const matches = (q: string, ...fields: (string | null | undefined)[]) =>
  fields.some((f) => f?.toLowerCase().includes(q));

/**
 * Permission-aware global search. Every group comes from the repository the matching page uses, so results are
 * scope-filtered on the server before they leave it — a faculty member searching a name outside their sections
 * gets nothing back.
 */
export async function GET(request: NextRequest) {
  const authed = await currentAuth();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse({ q: request.nextUrl.searchParams.get("q") ?? "" });
  const empty: SearchResponse = {
    students: [],
    faculty: [],
    courses: [],
    notices: [],
    units: [],
    question: null,
  };
  if (!parsed.success) return NextResponse.json(empty);
  const raw = parsed.data.q;
  const q = raw.toLowerCase();
  const { ctx, tree } = authed;
  const staff = ctx.assignments.some((a) => a.scopeMode !== "linked");
  const term = staff ? await getCurrentTerm(ctx.tenantId) : null;

  const [students, faculty, courses, inbox] = await Promise.all([
    searchStudents(authed, raw),
    staff ? listFaculty(authed, term?.id ?? null) : Promise.resolve(null),
    staff ? listCourses(authed) : Promise.resolve(null),
    listInbox(authed, "all"),
  ]);

  const units: SearchHit[] = staff
    ? [...tree.byId.values()]
        .filter(
          (u) =>
            (u.type === "department" || u.type === "section" || u.type === "campus") &&
            matches(q, u.name, u.code, u.type === "section" ? sectionLabel(u.code) : null),
        )
        .filter((u) => ctx.assignments.some((a) => a.scopeMode !== "linked" && coversUnit(a, u, tree)))
        .slice(0, LIMIT)
        .map((u) => ({
          id: u.id,
          label: u.name,
          sublabel:
            u.type === "section"
              ? "Section · attendance register"
              : u.type === "department"
                ? "Department · students"
                : "Campus",
          href:
            u.type === "section"
              ? `/students?sectionId=${u.code}`
              : u.type === "department"
                ? `/students?department=${u.code}`
                : `/dashboard?scope=${u.code}`,
        }))
    : [];

  const intent = parseIntent(raw);
  const body: SearchResponse = {
    students: students.map((s) => ({
      id: s.id,
      name: s.name,
      studentNumber: s.studentNumber,
      sectionLabel: s.sectionLabel,
    })),
    faculty: (faculty ?? [])
      .filter((f) => matches(q, f.name, f.employeeCode, f.email))
      .slice(0, LIMIT)
      .map((f) => ({
        id: f.userId,
        label: f.name,
        sublabel: `${f.designation} · ${f.departmentName}`,
        href: `/faculty/${f.userId}`,
      })),
    courses: (courses ?? [])
      .filter((c) => matches(q, c.code, c.name))
      .slice(0, LIMIT)
      .map((c) => ({
        id: c.id,
        label: `${c.code} ${c.name}`,
        sublabel: c.ownerName,
        href: `/courses?q=${encodeURIComponent(c.code)}`,
      })),
    notices: inbox
      .filter((a) => matches(q, a.title, a.summary, a.category))
      .slice(0, LIMIT)
      .map((a) => ({
        id: a.id,
        label: a.title,
        sublabel: `Notice · ${a.authorRole}`,
        href: `/announcements?view=all&id=${a.id}`,
      })),
    units,
    question: intent ? { text: raw, href: `/insights?q=${encodeURIComponent(raw)}` } : null,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
