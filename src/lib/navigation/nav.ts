import type { WorkspaceKind } from "@/lib/authz/catalogue";
import { isAvailable, MODULES, type IconName, type ModuleKey } from "@/lib/navigation/modules";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  phase: number;
  available: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

type Entry = ModuleKey | { module: ModuleKey; label?: string };
type GroupSpec = { label: string; items: Entry[] };

/**
 * Workspaces per PRD §30.4. A role maps to a workspace kind (authz/catalogue.ts); navigation is a UX
 * affordance only — every page and action enforces permissions on the server regardless of what is shown.
 */
const WORKSPACE_NAV: Record<WorkspaceKind, GroupSpec[]> = {
  admin: [
    { label: "Workspace", items: ["dashboard", "announcements", "insights"] },
    { label: "Institution", items: ["students", "faculty", "academics", "courses", "announcements-manage"] },
    { label: "Administration", items: ["access", "audit", "deliveries"] },
    { label: "Coming later", items: ["reports", "analytics"] },
  ],
  leadership: [
    { label: "Workspace", items: ["dashboard", "announcements", "approvals", "insights"] },
    {
      label: "Campus",
      items: [
        "students",
        "faculty",
        "academics",
        "attendance",
        "exams",
        "announcements-manage",
        "parent-communication",
      ],
    },
    {
      label: "Coming later",
      items: ["mentoring", "placements", "finance", "compliance", "reports", "analytics"],
    },
  ],
  department: [
    { label: "Workspace", items: ["dashboard", "announcements", "approvals", "insights"] },
    {
      label: "Department",
      items: [
        "students",
        "faculty",
        { module: "academics", label: "Programmes" },
        "courses",
        "attendance",
        "marks",
        "announcements-manage",
        "parent-communication",
      ],
    },
    { label: "Coming later", items: ["mentoring", "placements", "reports"] },
  ],
  class: [
    { label: "Workspace", items: ["dashboard", "announcements", "tasks", "approvals"] },
    {
      label: "My class",
      items: ["attendance", "students", "marks", "parent-communication", "announcements-manage", "insights"],
    },
    { label: "Coming later", items: ["mentoring", "requests"] },
  ],
  teaching: [
    { label: "Workspace", items: ["dashboard", "announcements", "tasks", "approvals"] },
    {
      label: "Teaching",
      items: ["my-courses", "attendance", "marks", "students", "announcements-manage", "insights"],
    },
    { label: "Coming later", items: ["assignments"] },
  ],
  self: [
    { label: "Me", items: ["dashboard", "announcements", { module: "students", label: "My profile" }] },
    { label: "Academics", items: ["my-timetable", "my-attendance", "my-exams", "my-academics"] },
    {
      label: "Coming later",
      items: ["assignments", "fees", "placements", "my-mentor", "documents", "requests"],
    },
  ],
  guardian: [
    {
      label: "My child",
      items: ["dashboard", "announcements", "my-messages", { module: "students", label: "Student profile" }],
    },
    { label: "Progress", items: ["my-timetable", "my-attendance", "my-exams", "my-academics"] },
    { label: "Coming later", items: ["fees"] },
  ],
  examinations: [
    { label: "Workspace", items: ["dashboard", "announcements", "approvals", "insights"] },
    { label: "Examinations", items: ["exams", "students", "announcements-manage"] },
  ],
  operations: [
    { label: "Workspace", items: ["dashboard", "announcements", "insights"] },
    { label: "Records", items: ["students"] },
  ],
};

export interface NavOptions {
  /** Student 360 target for self/guardian workspaces. */
  linkedStudentId?: string;
  /** Show Administration entries to holders of admin permissions outside the admin workspace. */
  canManageAccess?: boolean;
  canViewAudit?: boolean;
  /** Show "Announcements" (writing and sent notices) only to those who may publish. */
  canPublish?: boolean;
  /**
   * Include modules from later phases. Off in the app: people only see what they can use today (the planned-module
   * pages still answer direct links).
   */
  showPlanned?: boolean;
}

export function navigationFor(workspace: WorkspaceKind, opts: NavOptions = {}): NavGroup[] {
  const groups = WORKSPACE_NAV[workspace].map((g) => ({ ...g, items: [...g.items] }));
  if (!opts.canPublish)
    for (const g of groups)
      g.items = g.items.filter((e) => (typeof e === "string" ? e : e.module) !== "announcements-manage");
  if (workspace !== "admin" && (opts.canManageAccess || opts.canViewAudit)) {
    const items: Entry[] = [];
    if (opts.canManageAccess) items.push("access");
    if (opts.canViewAudit) items.push("audit", "deliveries");
    groups.push({ label: "Administration", items });
  }
  if (!opts.showPlanned)
    for (const g of groups)
      g.items = g.items.filter((e) => isAvailable(MODULES[typeof e === "string" ? e : e.module]));
  return groups
    .filter((g) => g.items.length > 0)
    .map((group) => ({
      label: group.label,
      items: group.items.map((entry) => {
        const spec = typeof entry === "string" ? { module: entry } : entry;
        const mod = MODULES[spec.module];
        const href =
          (workspace === "self" || workspace === "guardian") &&
          spec.module === "students" &&
          opts.linkedStudentId
            ? `/students/${opts.linkedStudentId}`
            : mod.path;
        return {
          key: mod.key,
          label: spec.label ?? mod.label,
          href,
          icon: mod.icon,
          phase: mod.phase,
          available: isAvailable(mod),
        };
      }),
    }));
}

export function flattenNav(groups: NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}

/** Whether a workspace includes a module — used for the planned-module page, not as an access control. */
export function workspaceHasModule(workspace: WorkspaceKind, key: ModuleKey): boolean {
  return WORKSPACE_NAV[workspace].some((g) =>
    g.items.some((e) => (typeof e === "string" ? e : e.module) === key),
  );
}
