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
    { label: "Workspace", items: ["dashboard", "students", "announcements"] },
    { label: "Academic structure", items: ["academics", "courses", "faculty"] },
    { label: "Administration", items: ["access", "audit", "deliveries"] },
    { label: "Insights", items: ["analytics", "reports"] },
  ],
  leadership: [
    { label: "Workspace", items: ["dashboard", "students", "announcements", "approvals"] },
    {
      label: "Academic operations",
      items: ["academics", "courses", "attendance", "marks", "exams", "mentoring", "parent-communication"],
    },
    { label: "Institution", items: ["faculty", "finance", "placements", "compliance"] },
    { label: "Insights", items: ["analytics", "reports"] },
  ],
  department: [
    {
      label: "Workspace",
      items: [
        "dashboard",
        { module: "students", label: "Department Students" },
        "announcements",
        "approvals",
      ],
    },
    {
      label: "Department",
      items: [
        { module: "academics", label: "Programmes" },
        "courses",
        "faculty",
        "attendance",
        "marks",
        "mentoring",
        "parent-communication",
        "placements",
      ],
    },
    { label: "Insights", items: ["reports"] },
  ],
  class: [
    { label: "Workspace", items: [{ module: "dashboard", label: "My Class" }, "students", "announcements"] },
    {
      label: "Class operations",
      items: ["attendance", "approvals", "mentoring", "marks", "parent-communication", "requests"],
    },
  ],
  teaching: [
    {
      label: "Workspace",
      items: [{ module: "dashboard", label: "My Classes" }, "my-courses", "students", "announcements"],
    },
    { label: "Teaching", items: ["attendance", "tasks", "approvals", "marks"] },
  ],
  self: [
    {
      label: "Me",
      items: [
        { module: "dashboard", label: "Home" },
        { module: "students", label: "My Profile" },
        "announcements",
      ],
    },
    { label: "Academics", items: ["my-attendance", "my-academics", "my-exams", "my-mentor"] },
    { label: "Services", items: ["fees", "placements", "documents", "requests"] },
  ],
  guardian: [
    {
      label: "My child",
      items: [
        { module: "dashboard", label: "Home" },
        { module: "students", label: "Student profile" },
        "announcements",
        "my-messages",
      ],
    },
    { label: "Progress", items: ["my-attendance", "my-academics", "my-exams", "fees"] },
  ],
  examinations: [
    { label: "Workspace", items: ["dashboard", "students", "announcements", "approvals"] },
    { label: "Examinations", items: ["exams"] },
  ],
  operations: [{ label: "Workspace", items: ["dashboard", "students", "announcements"] }],
};

export interface NavOptions {
  /** Student 360 target for self/guardian workspaces. */
  linkedStudentId?: string;
  /** Show Administration entries to holders of admin permissions outside the admin workspace. */
  canManageAccess?: boolean;
  canViewAudit?: boolean;
}

export function navigationFor(workspace: WorkspaceKind, opts: NavOptions = {}): NavGroup[] {
  const groups = WORKSPACE_NAV[workspace].map((g) => ({ ...g, items: [...g.items] }));
  if (workspace !== "admin" && (opts.canManageAccess || opts.canViewAudit)) {
    const items: Entry[] = [];
    if (opts.canManageAccess) items.push("access");
    if (opts.canViewAudit) items.push("audit", "deliveries");
    groups.push({ label: "Administration", items });
  }
  return groups.map((group) => ({
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
