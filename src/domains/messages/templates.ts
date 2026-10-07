/*
 * Guardian message templates. Each message is rendered per student from that student's record, so a guardian reads
 * their own child's figures, never a list. Placeholders are {student}, {roll}, {section}, {attendance}, {threshold},
 * {guardian}, {sender} and {institution}; unknown placeholders are left as written.
 */

export const TEMPLATE_KEYS = ["attendance_shortage", "exam_eligibility", "meeting", "general"] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface Template {
  key: TemplateKey;
  label: string;
  subject: string;
  body: string;
}

export const TEMPLATES: Record<TemplateKey, Template> = {
  attendance_shortage: {
    key: "attendance_shortage",
    label: "Attendance shortage",
    subject: "Attendance below {threshold}% — {student}",
    body: [
      "Dear {guardian},",
      "{student} ({roll}, section {section}) has {attendance}% attendance this term, below the required {threshold}%. Students below the requirement may not be permitted to write the semester-end examinations.",
      "Please speak with {student} about attending every class from now on, and contact me if there is a reason we should know about.",
      "Regards,\n{sender}",
    ].join("\n\n"),
  },
  exam_eligibility: {
    key: "exam_eligibility",
    label: "Exam eligibility",
    subject: "Semester-end examination eligibility — {student}",
    body: [
      "Dear {guardian},",
      "With {attendance}% attendance against the required {threshold}%, {student} ({roll}) is at risk of not being eligible for the November semester-end examinations.",
      "A condonation can be considered only for genuine reasons with supporting documents. Please meet me this week.",
      "Regards,\n{sender}",
    ].join("\n\n"),
  },
  meeting: {
    key: "meeting",
    label: "Meeting request",
    subject: "Request to meet — {student}",
    body: [
      "Dear {guardian},",
      "I would like to meet you to discuss {student}'s progress this term. Please acknowledge this message and reply with a convenient day this week.",
      "Regards,\n{sender}",
    ].join("\n\n"),
  },
  general: {
    key: "general",
    label: "General",
    subject: "",
    body: "Dear {guardian},\n\n\n\nRegards,\n{sender}",
  },
};

export type MergeFields = Record<
  "student" | "roll" | "section" | "attendance" | "threshold" | "guardian" | "sender" | "institution",
  string
>;

export function render(text: string, fields: MergeFields): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in fields ? fields[key as keyof MergeFields] : whole,
  );
}

/** A guardian who was told about a student's attendance in the last fortnight is not suggested again. */
export const RECONTACT_AFTER_DAYS = 14;
