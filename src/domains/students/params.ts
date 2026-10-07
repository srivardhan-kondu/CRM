import { z } from "zod";
import type { StudentQuery } from "./types";

/** URL search params → validated StudentQuery. Invalid values are dropped rather than erroring the page. */
const schema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  department: z
    .string()
    .regex(/^[A-Z]{2,8}$/)
    .optional()
    .catch(undefined),
  year: z.coerce.number().int().min(1).max(4).optional().catch(undefined),
  section: z
    .string()
    .regex(/^[A-Z]+-\d-[A-Z]$/)
    .optional()
    .catch(undefined),
  risk: z.enum(["none", "watch", "high", "any"]).optional().catch(undefined),
  fee: z.enum(["paid", "due", "overdue"]).optional().catch(undefined),
  shortage: z.enum(["1"]).optional().catch(undefined),
  sort: z.enum(["name", "number", "attendance", "cgpa"]).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseStudentQuery(raw: RawSearchParams): StudentQuery {
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const p = schema.parse(flat);
  return {
    q: p.q || undefined,
    department: p.department,
    year: p.year,
    sectionId: p.section,
    risk: p.risk,
    fee: p.fee,
    shortage: p.shortage === "1",
    sort: p.sort,
    dir: p.dir,
    page: p.page,
  };
}

/** StudentQuery → canonical URL search string (used for links, sort headers and pagination). */
export function toSearchParams(query: StudentQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (query.q) sp.set("q", query.q);
  if (query.department) sp.set("department", query.department);
  if (query.year) sp.set("year", String(query.year));
  if (query.sectionId) sp.set("section", query.sectionId);
  if (query.risk && query.risk !== "any") sp.set("risk", query.risk);
  if (query.fee) sp.set("fee", query.fee);
  if (query.shortage) sp.set("shortage", "1");
  if (query.sort) sp.set("sort", query.sort);
  if (query.dir) sp.set("dir", query.dir);
  if (query.page && query.page > 1) sp.set("page", String(query.page));
  return sp;
}

export function studentsHref(query: StudentQuery): string {
  const qs = toSearchParams(query).toString();
  return qs ? `/students?${qs}` : "/students";
}
