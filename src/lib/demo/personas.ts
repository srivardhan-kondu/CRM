/**
 * SYNTHETIC seeded users. The seed creates these users, memberships, role assignments and student links;
 * in demo mode the login page offers them as one-click accounts. Every name and email here is fictitious.
 */
import { STUDENTS } from "./fixtures";
import { DEMO_TENANT, OTHER_TENANT } from "./org";

export interface SeedAssignment {
  role: string;
  orgUnitCode: string;
  scopeMode: "subtree" | "unit" | "linked";
  courseCodes?: string[];
}

/**
 * Faculty-role assignments the Phase 1 seed granted directly. Phase 2 replaces them with teaching allocations, so
 * re-seeding an existing database revokes them (with this reason) instead of leaving duplicate access.
 */
export const SUPERSEDED_FACULTY_GRANTS = {
  personaKeys: ["class_incharge", "faculty"],
  reason: "Superseded by teaching allocation (Phase 2)",
} as const;

export interface SeedUser {
  key: string;
  name: string;
  email: string;
  title: string;
  tenantSlug: string;
  assignments: SeedAssignment[];
  links?: { studentNumber: string; relation: "self" | "guardian" }[];
  /** Shown on the login page in demo mode. */
  persona: boolean;
}

const demoStudent = STUDENTS.find((s) => s.sectionId === "CSE-3-A")!;
const email = (local: string) => `${local}@demo.campusos.dev`;

export const SEED_USERS: SeedUser[] = [
  {
    key: "super_admin",
    name: "Asha Menon",
    email: email("platform.admin"),
    title: "Super Admin · Platform",
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "super_admin", orgUnitCode: "DUG", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "director",
    name: "Mr. Vikram Sethi",
    email: email("director"),
    title: "Director · Demo University Group",
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "director", orgUnitCode: "DUG", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "principal",
    name: "Dr. Meera Raghavan",
    email: email("principal"),
    title: "Principal",
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "principal", orgUnitCode: "DUG", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "hod_cse",
    name: "Prof. Arvind Kulkarni",
    email: email("hod.cse"),
    title: "HOD, Computer Science & Engineering",
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "hod", orgUnitCode: "CSE", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "programme_coordinator",
    name: "Dr. Sunita Menon",
    email: email("pc.btech.cse"),
    title: "Programme Coordinator, B.Tech CSE",
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "programme_coordinator", orgUnitCode: "CSE", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "class_incharge",
    name: "Ms. Kavya Nair",
    email: email("kavya.nair"),
    title: "Class Incharge, 3-CSE-A · Faculty, Operating Systems",
    tenantSlug: DEMO_TENANT.slug,
    // Granted: full class view of 3-CSE-A. Teaching CS302 in 3-CSE-A and 3-CSE-B (academics.ts) adds course-only
    // access to 3-CSE-B through allocation — two scopes, two sources.
    assignments: [{ role: "class_incharge", orgUnitCode: "CSE-3-A", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "faculty",
    name: "Mr. Rahul Verma",
    email: email("rahul.verma"),
    title: "Assistant Professor, CSE · DBMS",
    tenantSlug: DEMO_TENANT.slug,
    // No granted role: all access derives from teaching CS301 in 3-CSE-A and 3-CSE-B this term (academics.ts).
    assignments: [],
    persona: true,
  },
  {
    key: "exam_controller",
    name: "Dr. Leela Krishnan",
    email: email("coe"),
    title: "Controller of Examinations · Examination Cell",
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "exam_controller", orgUnitCode: "DUG", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "finance",
    name: "Ms. Anjali Rao",
    email: email("accounts"),
    title: "Finance Officer · Accounts Office",
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "finance_officer", orgUnitCode: "DUG", scopeMode: "subtree" }],
    persona: true,
  },
  {
    key: "student",
    name: demoStudent.name,
    email: demoStudent.email,
    title: `Student · ${demoStudent.studentNumber} · ${demoStudent.sectionLabel}`,
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "student", orgUnitCode: "DUG", scopeMode: "linked" }],
    links: [{ studentNumber: demoStudent.studentNumber, relation: "self" }],
    persona: true,
  },
  {
    key: "parent",
    name: demoStudent.guardian.name,
    email: email(`guardian.${demoStudent.studentNumber.toLowerCase()}`),
    title: `${demoStudent.guardian.relation} of ${demoStudent.name}`,
    tenantSlug: DEMO_TENANT.slug,
    assignments: [{ role: "parent", orgUnitCode: "DUG", scopeMode: "linked" }],
    links: [{ studentNumber: demoStudent.studentNumber, relation: "guardian" }],
    persona: true,
  },
  {
    key: "other_tenant_principal",
    name: "Dr. Rohan Iyer",
    email: "principal@northfield.campusos.dev",
    title: "Principal · Northfield College",
    tenantSlug: OTHER_TENANT.slug,
    assignments: [{ role: "principal", orgUnitCode: "NFC", scopeMode: "subtree" }],
    persona: true,
  },
];

export const DEMO_STUDENT_NUMBER = demoStudent.studentNumber;
