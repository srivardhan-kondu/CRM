import type { AnnouncementCategory, AnnouncementStatus } from "@/domains/announcements/types";
import type { BadgeTone } from "@/components/ui/badge";

export const CATEGORY_LABEL: Record<AnnouncementCategory, string> = {
  academic: "Academic",
  examinations: "Examinations",
  results: "Results",
  placement: "Placement",
  internships: "Internship",
  scholarships: "Scholarships & Finance",
  administrative: "Administrative",
  events: "Event",
  compliance: "Compliance",
  emergency: "Emergency",
  general: "General",
};

export const STATUS_LABEL: Record<AnnouncementStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending: { label: "Awaiting approval", tone: "warning" },
  published: { label: "Published", tone: "success" },
  rejected: { label: "Returned", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};
