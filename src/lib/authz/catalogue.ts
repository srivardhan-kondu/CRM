/**
 * Permission catalogue and system role definitions — the single source the seed writes into
 * `permission` / `role` / `role_permission`. At runtime, permissions are read from the database, so an
 * institution can change role permissions without a deploy.
 *
 * Key grammar: "<resource>:<action>" for actions, "<resource>.<field-class>:read" for field sensitivity.
 */
export const PERMISSIONS = {
  "student:view": "Open student records within scope",
  "student:export": "Export student lists (separate from view; audited)",
  "student.contact:read": "Read student contact details",
  "student.guardian:read": "Read guardian details",
  "student.academic:read": "Read cohort-wide academics: overall attendance, CGPA, credits, backlogs",
  "student.course_attendance:read": "Read attendance for courses in the assignment's teaching context",
  "student.risk:read": "Read risk flags and mentoring notes",
  "student.finance:read": "Read fee status and dues",
  "announcement:view": "Read announcements addressed to the user",
  "announcement:publish": "Publish announcements to audiences within scope",
  "announcement:approve":
    "Approve announcements others submit for audiences within scope; publish broad and critical notices directly",
  "guardian:message": "Message the guardians of students in scope, and address announcements to guardians",
  "approval:view": "See pending approvals within scope",
  "attendance:edit":
    "Mark attendance on the day of the class, and request corrections afterwards, within scope",
  "attendance:approve": "Approve attendance corrections and late submissions within scope",
  "leave:request":
    "Apply for on-duty or medical leave for students in scope (students and guardians: their own)",
  "leave:approve": "Approve students' on-duty and medical leave within scope",
  "marks:enter": "Enter and submit internal assessment marks for the courses taught, within scope",
  "marks:moderate": "Approve or return submitted internal assessment marks within scope",
  "exam:manage": "Run examinations: timetable, semester-end marks, results publication and revaluation",
  "exam:condone": "Decide attendance condonation for examination eligibility",
  "condonation:request": "Request attendance condonation for students in scope",
  "revaluation:request": "Request revaluation of a semester-end answer script (students: their own)",
  "user:manage": "Invite users, suspend memberships and revoke sessions within scope",
  "role_assignment:manage": "Grant and revoke role assignments within scope",
  "audit:view": "Read the audit trail",
  "academics:view": "Read the academic structure: programmes, regulations, courses, terms and offerings",
  "academics:manage":
    "Maintain the academic structure in scope: courses, draft and publish regulations, generate offerings, set the current term",
  "teaching:allocate": "Allocate faculty to course offerings in scope (allocation grants teaching access)",
  "faculty:view": "Read faculty profiles and teaching load in scope",
  "student:manage": "Edit student records and transfer students between sections in scope",
  // Platform-level duties (PRD §3: tenant setup, security, integrations). Held only by Super Admin, which also keeps
  // Super Admin above every other role's delegation ceiling.
  "tenant:configure": "Configure the institution: security policy, integrations, role definitions",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export type WorkspaceKind =
  | "admin"
  | "leadership"
  | "department"
  | "class"
  | "teaching"
  | "self"
  | "guardian"
  | "examinations"
  | "operations";

export interface RoleDefinition {
  key: string;
  name: string;
  /** Lower = more senior. Decides the default workspace when a user holds several roles. */
  rank: number;
  workspace: WorkspaceKind;
  permissions: PermissionKey[];
}

// Cohort-wide academics include every course's attendance. Listing the course-level permission explicitly keeps the
// delegation ceiling (grant only what you hold) correct: whoever reads all academics may manage faculty.
const ACADEMIC_READ: PermissionKey[] = ["student.academic:read", "student.course_attendance:read"];

const STUDENT_FIELDS_ACADEMIC: PermissionKey[] = [
  "student.contact:read",
  "student.guardian:read",
  ...ACADEMIC_READ,
  "student.risk:read",
];

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    rank: 0,
    workspace: "admin",
    permissions: Object.keys(PERMISSIONS) as PermissionKey[],
  },
  {
    key: "director",
    name: "Director",
    rank: 10,
    workspace: "leadership",
    permissions: [
      "student:view",
      "student:export",
      ...STUDENT_FIELDS_ACADEMIC,
      "student.finance:read",
      "announcement:view",
      "announcement:publish",
      "announcement:approve",
      "guardian:message",
      "approval:view",
      "audit:view",
      "academics:view",
      "faculty:view",
    ],
  },
  {
    key: "principal",
    name: "Principal",
    rank: 20,
    workspace: "leadership",
    permissions: [
      "student:view",
      "student:export",
      ...STUDENT_FIELDS_ACADEMIC,
      "student.finance:read",
      "announcement:view",
      "announcement:publish",
      "announcement:approve",
      "guardian:message",
      "approval:view",
      // Held so the principal can appoint HODs and class incharges (delegation ceiling). Changes after the day
      // still go through a request that someone other than the requester approves.
      "attendance:edit",
      "attendance:approve",
      "leave:request",
      "leave:approve",
      "marks:enter",
      "marks:moderate",
      "exam:manage",
      "exam:condone",
      "condonation:request",
      "revaluation:request",
      "user:manage",
      "role_assignment:manage",
      "audit:view",
      "academics:view",
      "academics:manage",
      "teaching:allocate",
      "faculty:view",
      "student:manage",
    ],
  },
  {
    key: "dean",
    name: "Dean",
    rank: 30,
    workspace: "leadership",
    permissions: [
      "student:view",
      ...STUDENT_FIELDS_ACADEMIC,
      "announcement:view",
      "announcement:publish",
      "announcement:approve",
      "approval:view",
      "academics:view",
      "faculty:view",
    ],
  },
  {
    key: "hod",
    name: "Head of Department",
    rank: 40,
    workspace: "department",
    permissions: [
      "student:view",
      ...STUDENT_FIELDS_ACADEMIC,
      "announcement:view",
      "announcement:publish",
      "announcement:approve",
      "guardian:message",
      "approval:view",
      "attendance:edit",
      "attendance:approve",
      "leave:request",
      "leave:approve",
      "marks:enter",
      "marks:moderate",
      "condonation:request",
      "academics:view",
      "academics:manage",
      "teaching:allocate",
      "faculty:view",
    ],
  },
  {
    key: "programme_coordinator",
    name: "Programme Coordinator",
    rank: 50,
    workspace: "department",
    permissions: [
      "student:view",
      ...ACADEMIC_READ,
      "student.risk:read",
      "announcement:view",
      "announcement:publish",
      // Coordinators draft regulations for their programme; allocation stays with the HOD.
      "academics:view",
      "academics:manage",
      "faculty:view",
    ],
  },
  {
    key: "year_coordinator",
    name: "Year Coordinator",
    rank: 55,
    workspace: "department",
    permissions: [
      "student:view",
      ...ACADEMIC_READ,
      "student.risk:read",
      "student.contact:read",
      "announcement:view",
      "announcement:publish",
      "academics:view",
    ],
  },
  {
    key: "class_incharge",
    name: "Class Incharge",
    rank: 60,
    workspace: "class",
    permissions: [
      "student:view",
      ...STUDENT_FIELDS_ACADEMIC,
      "announcement:view",
      "announcement:publish",
      "guardian:message",
      "approval:view",
      "attendance:edit",
      "leave:request",
      "leave:approve",
      "marks:enter",
      "condonation:request",
      "academics:view",
    ],
  },
  {
    key: "faculty",
    name: "Faculty",
    rank: 70,
    workspace: "teaching",
    permissions: [
      "student:view",
      "student.course_attendance:read",
      "announcement:view",
      "announcement:publish",
      "attendance:edit",
      "marks:enter",
      "academics:view",
    ],
  },
  {
    key: "exam_controller",
    name: "Controller of Examinations",
    rank: 35,
    workspace: "examinations",
    permissions: [
      "student:view",
      ...ACADEMIC_READ,
      "announcement:view",
      "announcement:publish",
      "approval:view",
      "academics:view",
      "exam:manage",
      "exam:condone",
    ],
  },
  {
    key: "finance_officer",
    name: "Finance Officer",
    rank: 36,
    workspace: "operations",
    // Finance sees finance data without the academic/risk/guardian detail it does not need (PRD §19).
    permissions: ["student:view", "student.finance:read", "student.contact:read", "announcement:view"],
  },
  {
    key: "placement_head",
    name: "Placement Head",
    rank: 37,
    workspace: "operations",
    permissions: [
      "student:view",
      ...ACADEMIC_READ,
      "student.contact:read",
      "announcement:view",
      "announcement:publish",
      "academics:view",
    ],
  },
  {
    key: "student",
    name: "Student",
    rank: 90,
    workspace: "self",
    permissions: [
      "student:view",
      ...STUDENT_FIELDS_ACADEMIC,
      "student.finance:read",
      "announcement:view",
      "leave:request",
      "revaluation:request",
    ],
  },
  {
    key: "parent",
    name: "Parent / Guardian",
    rank: 95,
    workspace: "guardian",
    permissions: [
      "student:view",
      ...ACADEMIC_READ,
      "student.finance:read",
      "student.guardian:read",
      "announcement:view",
      "leave:request",
    ],
  },
];

export function roleDefinition(key: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((r) => r.key === key);
}

export function workspaceFor(roleKey: string): WorkspaceKind {
  return roleDefinition(roleKey)?.workspace ?? "operations";
}
