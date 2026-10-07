/**
 * Module registry — single source for routes, labels, icons and delivery phase.
 * A module with `phase > CURRENT_PHASE` renders an explicit "planned" page instead of a fake screen.
 */
export const CURRENT_PHASE = 5;

export type IconName =
  | "home"
  | "users"
  | "user"
  | "book"
  | "calendar-check"
  | "clipboard"
  | "heart-handshake"
  | "wallet"
  | "briefcase"
  | "megaphone"
  | "chart"
  | "shield-check"
  | "check-square"
  | "file-text"
  | "graduation-cap"
  | "school"
  | "message"
  | "inbox"
  | "list-checks"
  | "folder"
  | "key"
  | "scroll"
  | "sparkles"
  | "megaphone-plus"
  | "calendar";

export interface ModuleDef {
  key: string;
  path: string;
  label: string;
  icon: IconName;
  phase: number;
  description: string;
}

const defs = [
  {
    key: "access",
    path: "/admin/access",
    label: "Users & access",
    icon: "key",
    phase: 1,
    description:
      "Provision users, grant and revoke scoped role assignments, suspend access and revoke sessions.",
  },
  {
    key: "audit",
    path: "/admin/audit",
    label: "Audit log",
    icon: "scroll",
    phase: 1,
    description: "Append-only record of sign-ins, sensitive reads, permission changes and denials.",
  },
  {
    key: "dashboard",
    path: "/dashboard",
    label: "Home",
    icon: "home",
    phase: 0,
    description: "Role-specific home: what needs attention, what to do next.",
  },
  {
    key: "students",
    path: "/students",
    label: "Students",
    icon: "users",
    phase: 0,
    description: "Student directory and Student 360.",
  },
  {
    key: "announcements",
    path: "/announcements",
    label: "Inbox",
    icon: "inbox",
    phase: 0,
    description: "Campus inbox: notices addressed to you, with read, save and acknowledgement.",
  },
  {
    key: "academics",
    path: "/academics",
    label: "Academics",
    icon: "graduation-cap",
    phase: 2,
    description: "Academic years, programmes, curriculum, courses, offerings and sections.",
  },
  {
    key: "courses",
    path: "/courses",
    label: "Courses",
    icon: "book",
    phase: 2,
    description: "Course catalogue, offerings and faculty allocation for your scope.",
  },
  {
    key: "faculty",
    path: "/faculty",
    label: "Faculty",
    icon: "school",
    phase: 2,
    description: "Faculty profiles, assignments and teaching load.",
  },
  {
    key: "attendance",
    path: "/attendance",
    label: "Attendance",
    icon: "calendar-check",
    phase: 3,
    description: "Session marking, bulk actions, corrections workflow and shortage analytics.",
  },
  {
    key: "approvals",
    path: "/approvals",
    label: "Approvals",
    icon: "check-square",
    phase: 3,
    description: "Approval queue with SLAs — attendance corrections first, then all workflows.",
  },
  {
    key: "tasks",
    path: "/tasks",
    label: "Tasks",
    icon: "list-checks",
    phase: 3,
    description: "Pending attendance submissions, corrections and assigned follow-ups.",
  },
  {
    key: "exams",
    path: "/exams",
    label: "Examinations",
    icon: "clipboard",
    phase: 4,
    description: "Assessments, mark entry, moderation, result publishing and revaluation.",
  },
  {
    key: "marks",
    path: "/marks",
    label: "Marks",
    icon: "clipboard",
    phase: 4,
    description: "Internal assessment mark entry with validation and review.",
  },
  {
    key: "parent-communication",
    path: "/parent-communication",
    label: "Parent communication",
    icon: "message",
    phase: 5,
    description: "Targeted guardian messages through the notification layer.",
  },
  {
    key: "announcements-manage",
    path: "/announcements/sent",
    label: "Announcements",
    icon: "megaphone",
    phase: 5,
    description: "Write, schedule and target notices; see who read and acknowledged them.",
  },
  {
    key: "insights",
    path: "/insights",
    label: "Insights",
    icon: "sparkles",
    phase: 5,
    description: "Ask CampusOS: questions about your scope, answered from permission-checked records.",
  },
  {
    key: "my-timetable",
    path: "/my/timetable",
    label: "Timetable",
    icon: "calendar",
    phase: 5,
    description: "Your weekly class timetable.",
  },
  {
    key: "assignments",
    path: "/assignments",
    label: "Assignments",
    icon: "file-text",
    phase: 11,
    description: "Coursework and submissions through the LMS integration.",
  },
  {
    key: "deliveries",
    path: "/admin/deliveries",
    label: "Delivery log",
    icon: "inbox",
    phase: 5,
    description:
      "Every email the institution sends: queued, held for quiet hours, sent or without an address.",
  },
  {
    key: "mentoring",
    path: "/mentoring",
    label: "Mentoring",
    icon: "heart-handshake",
    phase: 6,
    description: "Mentor assignments, meetings, interventions and explainable risk signals.",
  },
  {
    key: "finance",
    path: "/finance",
    label: "Finance",
    icon: "wallet",
    phase: 7,
    description: "Fee plans, invoices, dues, concessions and collection health.",
  },
  {
    key: "fees",
    path: "/fees",
    label: "Fees",
    icon: "wallet",
    phase: 7,
    description: "Your invoices, dues, receipts and payment status.",
  },
  {
    key: "documents",
    path: "/documents",
    label: "Documents",
    icon: "folder",
    phase: 7,
    description: "Document vault, verification and certificates.",
  },
  {
    key: "requests",
    path: "/requests",
    label: "Requests",
    icon: "inbox",
    phase: 7,
    description: "Certificates, leave and other student requests with tracked workflow.",
  },
  {
    key: "placements",
    path: "/placements",
    label: "Placements",
    icon: "briefcase",
    phase: 8,
    description: "Drives, eligibility rules, applications, offers and internships.",
  },
  {
    key: "analytics",
    path: "/analytics",
    label: "Analytics",
    icon: "chart",
    phase: 9,
    description: "KPI definitions, cohort analysis, heatmaps and drill-down.",
  },
  {
    key: "reports",
    path: "/reports",
    label: "Reports",
    icon: "file-text",
    phase: 9,
    description: "Saved reports and permission-checked exports.",
  },
  {
    key: "compliance",
    path: "/compliance",
    label: "Accreditation",
    icon: "shield-check",
    phase: 9,
    description: "Accreditation evidence workspace with owners and freshness.",
  },
  {
    key: "my-academics",
    path: "/my/academics",
    label: "Results",
    icon: "graduation-cap",
    phase: 4,
    description: "Your registrations, results, grades and credit progress.",
  },
  {
    key: "my-exams",
    path: "/my/exams",
    label: "Exams",
    icon: "clipboard",
    phase: 4,
    description: "Your exam schedule, hall tickets and results.",
  },
  {
    key: "my-attendance",
    path: "/my/attendance",
    label: "Attendance",
    icon: "calendar-check",
    phase: 3,
    description: "Subject-wise attendance with shortage projection.",
  },
  {
    key: "my-messages",
    path: "/my/messages",
    label: "Messages",
    icon: "message",
    phase: 5,
    description: "Personal messages about your child from the college, with acknowledgement and reply.",
  },
  {
    key: "my-mentor",
    path: "/my/mentor",
    label: "Mentor",
    icon: "heart-handshake",
    phase: 6,
    description: "Your mentor, meetings and agreed action items.",
  },
  {
    key: "my-courses",
    path: "/my/courses",
    label: "My courses",
    icon: "book",
    phase: 2,
    description: "Courses you teach this term, with enrolled students.",
  },
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof defs)[number]["key"];

export const MODULES: Record<ModuleKey, ModuleDef> = Object.fromEntries(
  defs.map((d) => [d.key, d]),
) as Record<ModuleKey, ModuleDef>;

export function findModuleByPath(path: string): ModuleDef | undefined {
  return defs.find((d) => d.path === path);
}

export function isAvailable(mod: ModuleDef): boolean {
  return mod.phase <= CURRENT_PHASE;
}
