import type { DepartmentCode } from "@/domains/org/types";

export const CATEGORIES = [
  "academic",
  "examinations",
  "results",
  "placement",
  "internships",
  "scholarships",
  "administrative",
  "events",
  "compliance",
  "emergency",
  "general",
] as const;

export type AnnouncementCategory = (typeof CATEGORIES)[number];

export const SEVERITIES = ["critical", "high", "normal", "low"] as const;

export type Severity = (typeof SEVERITIES)[number];

/**
 * Who inside the target receives a notice. Guardians receive through their linked students; "families" is students
 * and their guardians; "everyone" adds the staff whose scope overlaps the target.
 */
export const AUDIENCE_GROUPS = ["everyone", "families", "students", "guardians", "staff"] as const;

export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

/**
 * Audience rules are data, not UI: a target in the hierarchy plus the groups inside it. They are evaluated against the
 * viewer's scope and linked students (visibility.ts) and resolved to recipients when a notice is published.
 */
export type AudienceRule =
  | { kind: "institution"; audience: AudienceGroup }
  | { kind: "department"; departmentCode: DepartmentCode; audience: AudienceGroup }
  | { kind: "year"; departmentCode: DepartmentCode; year: number; audience: AudienceGroup }
  | { kind: "section"; sectionId: string; audience: AudienceGroup }
  /** Students of a year across departments (placement drives). Students only. */
  | { kind: "placement_eligible"; departmentCodes: DepartmentCode[]; year: number };

export type AnnouncementStatus = "draft" | "pending" | "published" | "rejected" | "withdrawn";

export interface AttachmentMeta {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface Announcement {
  id: string;
  title: string;
  summary: string;
  body: string[];
  category: AnnouncementCategory;
  severity: Severity;
  author: string;
  authorRole: string;
  authorId: string | null;
  status: AnnouncementStatus;
  publishedAt: string;
  expiresAt: string | null;
  deadline: string | null;
  requiresAck: boolean;
  sendEmail: boolean;
  audience: AudienceRule;
  audienceLabel: string;
  audienceUnitId: string;
  attachments: AttachmentMeta[];
  /** Links to modules from later phases ("Register" for placement drives); never actionable before that phase. */
  cta: { label: string; phase: number } | null;
}

/** The viewer's own state on a notice they can see. */
export interface ViewerState {
  /** Addressed to the viewer (as a recipient), not only visible through oversight of their scope. */
  addressed: boolean;
  read: boolean;
  acknowledged: boolean;
  saved: boolean;
}

export type InboxItem = Announcement & ViewerState;

export type InboxView = "today" | "mine" | "exams" | "jobs" | "saved" | "history";
