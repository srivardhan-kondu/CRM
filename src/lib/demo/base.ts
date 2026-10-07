/**
 * SYNTHETIC DEMO DATA — every person, ID and organisation here is generated and fictitious.
 *
 * Base facts of the synthetic institution: reference clock, departments, course lists, faculty names, sections,
 * roll numbering and the deterministic PRNG. Everything else in `src/lib/demo` derives from this module, which
 * imports nothing from its siblings so the generators never form an import cycle.
 */
import type { Campus, Department, School, Section } from "@/domains/org/types";

/** Fixed reference "now" so the demo renders identically on server, client and in tests. */
export const DEMO_NOW = new Date("2026-10-06T09:30:00+05:30");

export const ATTENDANCE_THRESHOLD = 75;
export const CGPA_THRESHOLD = 6;
export const BACKLOG_THRESHOLD = 2;

export const CAMPUSES: Campus[] = [
  { id: "city", name: "City Campus" },
  { id: "tech", name: "Tech Campus" },
];

export const SCHOOLS: School[] = [
  { id: "eng", name: "School of Engineering", campusId: "tech" },
  { id: "mgmt", name: "School of Management", campusId: "city" },
  { id: "sci", name: "School of Sciences", campusId: "city" },
];

export const DEPARTMENTS: Department[] = [
  {
    code: "CSE",
    name: "Computer Science & Engineering",
    schoolId: "eng",
    programme: "B.Tech CSE",
    years: 4,
    sections: ["A", "B", "C"],
  },
  {
    code: "ECE",
    name: "Electronics & Communication",
    schoolId: "eng",
    programme: "B.Tech ECE",
    years: 4,
    sections: ["A", "B"],
  },
  {
    code: "EEE",
    name: "Electrical & Electronics",
    schoolId: "eng",
    programme: "B.Tech EEE",
    years: 4,
    sections: ["A", "B"],
  },
  {
    code: "MECH",
    name: "Mechanical Engineering",
    schoolId: "eng",
    programme: "B.Tech Mechanical",
    years: 4,
    sections: ["A", "B"],
  },
  {
    code: "MBA",
    name: "Business Administration",
    schoolId: "mgmt",
    programme: "MBA",
    years: 2,
    sections: ["A", "B"],
  },
  {
    code: "MCA",
    name: "Computer Applications",
    schoolId: "sci",
    programme: "MCA",
    years: 2,
    sections: ["A", "B"],
  },
];

export const BATCH_BY_YEAR: Record<number, { start: number; semester: number }> = {
  1: { start: 2026, semester: 1 },
  2: { start: 2025, semester: 3 },
  3: { start: 2024, semester: 5 },
  4: { start: 2023, semester: 7 },
};

export const COURSES: Record<string, [string, string][]> = {
  "CSE-1": [
    ["MA101", "Engineering Mathematics I"],
    ["PH101", "Engineering Physics"],
    ["CS101", "Programming in C"],
    ["EE101", "Basic Electrical Engineering"],
    ["HS101", "Professional Communication"],
  ],
  "CSE-2": [
    ["CS201", "Data Structures"],
    ["CS202", "Discrete Mathematics"],
    ["CS203", "Digital Logic Design"],
    ["CS204", "Object-Oriented Programming"],
    ["MA201", "Probability & Statistics"],
  ],
  "CSE-3": [
    ["CS301", "Database Management Systems"],
    ["CS302", "Operating Systems"],
    ["CS303", "Computer Networks"],
    ["CS304", "Software Engineering"],
    ["CS305", "Design & Analysis of Algorithms"],
  ],
  "CSE-4": [
    ["CS401", "Machine Learning"],
    ["CS402", "Distributed Systems"],
    ["CS403", "Information Security"],
    ["CS404", "Cloud Computing"],
    ["CS405", "Major Project I"],
  ],
  "ECE-1": [
    ["MA101", "Engineering Mathematics I"],
    ["PH101", "Engineering Physics"],
    ["EC101", "Basic Electronics"],
    ["CS101", "Programming in C"],
    ["HS101", "Professional Communication"],
  ],
  "ECE-2": [
    ["EC201", "Network Theory"],
    ["EC202", "Electronic Devices"],
    ["EC203", "Signals & Systems"],
    ["EC204", "Digital Electronics"],
    ["MA201", "Probability & Statistics"],
  ],
  "ECE-3": [
    ["EC301", "Analog Communication"],
    ["EC302", "Microprocessors"],
    ["EC303", "Control Systems"],
    ["EC304", "Linear IC Applications"],
    ["EC305", "Electromagnetic Waves"],
  ],
  "ECE-4": [
    ["EC401", "VLSI Design"],
    ["EC402", "Wireless Communication"],
    ["EC403", "Embedded Systems"],
    ["EC404", "Optical Communication"],
    ["EC405", "Major Project I"],
  ],
  "EEE-1": [
    ["MA101", "Engineering Mathematics I"],
    ["CH101", "Engineering Chemistry"],
    ["EE101", "Basic Electrical Engineering"],
    ["CS101", "Programming in C"],
    ["ME101", "Engineering Graphics"],
  ],
  "EEE-2": [
    ["EE201", "Electrical Circuits"],
    ["EE202", "Electrical Machines I"],
    ["EE203", "Electromagnetic Fields"],
    ["EE204", "Analog Electronics"],
    ["MA203", "Numerical Methods"],
  ],
  "EEE-3": [
    ["EE301", "Power Systems I"],
    ["EE302", "Electrical Machines II"],
    ["EE303", "Power Electronics"],
    ["EE304", "Control Systems"],
    ["EE305", "Measurements & Instrumentation"],
  ],
  "EEE-4": [
    ["EE401", "Power Systems II"],
    ["EE402", "Renewable Energy Systems"],
    ["EE403", "Electric Drives"],
    ["EE404", "High Voltage Engineering"],
    ["EE405", "Major Project I"],
  ],
  "MECH-1": [
    ["MA101", "Engineering Mathematics I"],
    ["PH101", "Engineering Physics"],
    ["ME101", "Engineering Graphics"],
    ["ME102", "Workshop Practice"],
    ["HS101", "Professional Communication"],
  ],
  "MECH-2": [
    ["ME201", "Engineering Mechanics"],
    ["ME202", "Thermodynamics"],
    ["ME203", "Material Science"],
    ["ME204", "Manufacturing Processes"],
    ["MA203", "Numerical Methods"],
  ],
  "MECH-3": [
    ["ME301", "Heat Transfer"],
    ["ME302", "Design of Machine Elements"],
    ["ME303", "Fluid Machinery"],
    ["ME304", "Metrology"],
    ["ME305", "Dynamics of Machinery"],
  ],
  "MECH-4": [
    ["ME401", "Finite Element Analysis"],
    ["ME402", "Automobile Engineering"],
    ["ME403", "Industrial Engineering"],
    ["ME404", "CAD/CAM"],
    ["ME405", "Major Project I"],
  ],
  "MBA-1": [
    ["MB101", "Managerial Economics"],
    ["MB102", "Financial Accounting"],
    ["MB103", "Organisational Behaviour"],
    ["MB104", "Marketing Management"],
    ["MB105", "Business Statistics"],
  ],
  "MBA-2": [
    ["MB201", "Strategic Management"],
    ["MB202", "Corporate Finance"],
    ["MB203", "Business Analytics"],
    ["MB204", "Human Resource Management"],
    ["MB205", "Summer Internship Report"],
  ],
  "MCA-1": [
    ["CA101", "Data Structures using Python"],
    ["CA102", "Computer Organisation"],
    ["CA103", "Database Systems"],
    ["CA104", "Discrete Mathematics"],
    ["CA105", "Web Technologies"],
  ],
  "MCA-2": [
    ["CA201", "Cloud Computing"],
    ["CA202", "Machine Learning"],
    ["CA203", "Mobile Application Development"],
    ["CA204", "Software Testing"],
    ["CA205", "Major Project"],
  ],
};

export function coursesFor(departmentCode: string, year: number): { code: string; name: string }[] {
  return (COURSES[`${departmentCode}-${year}`] ?? []).map(([code, name]) => ({ code, name }));
}

export const FACULTY_BY_DEPT: Record<string, string[]> = {
  CSE: [
    "Ms. Kavya Nair",
    "Mr. Rahul Verma",
    "Dr. Sunita Menon",
    "Mr. Imran Qureshi",
    "Dr. Pooja Bhatt",
    "Mr. Karthik Rao",
  ],
  ECE: ["Dr. Lakshmi Iyer", "Mr. Vivek Saxena", "Ms. Neha Kapoor", "Dr. Anil Joshi"],
  EEE: ["Dr. Ramesh Pillai", "Ms. Divya Hegde", "Mr. Suresh Babu"],
  MECH: ["Dr. Harish Chandra", "Mr. Ajay Thakur", "Ms. Swati Kulkarni"],
  MBA: ["Dr. Nandini Sen", "Prof. Rohit Malhotra"],
  MCA: ["Dr. Farah Siddiqui", "Mr. Deepak Gowda"],
};

export const FIRST_F = [
  "Aanya",
  "Diya",
  "Ishita",
  "Kavya",
  "Meera",
  "Nikita",
  "Priya",
  "Riya",
  "Sanya",
  "Tanvi",
  "Ananya",
  "Pooja",
  "Sneha",
  "Aditi",
  "Shreya",
  "Lakshmi",
  "Fatima",
  "Harini",
  "Neha",
  "Zoya",
];
export const FIRST_M = [
  "Aarav",
  "Aditya",
  "Arjun",
  "Dev",
  "Ishaan",
  "Karan",
  "Manav",
  "Nikhil",
  "Rohan",
  "Siddharth",
  "Vihaan",
  "Yash",
  "Rahul",
  "Varun",
  "Abhishek",
  "Imran",
  "Kiran",
  "Pranav",
  "Rajat",
  "Sai",
];
export const LAST = [
  "Sharma",
  "Iyer",
  "Reddy",
  "Nair",
  "Patel",
  "Gupta",
  "Menon",
  "Rao",
  "Das",
  "Khan",
  "Joshi",
  "Kulkarni",
  "Banerjee",
  "Singh",
  "Pillai",
  "Mehta",
  "Chatterjee",
  "Hegde",
  "Verma",
  "Bose",
  "Naidu",
  "Shetty",
];

/** mulberry32 — tiny deterministic PRNG so fixtures are stable across runs. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)] as T;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function syntheticUuid(key: string): string {
  const r = rng(hash(key));
  const hex = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const SECTIONS: Section[] = DEPARTMENTS.flatMap((d) =>
  Array.from({ length: d.years }, (_, i) => i + 1).flatMap((year) =>
    d.sections.map((letter) => {
      const batch = BATCH_BY_YEAR[year]!;
      return {
        id: `${d.code}-${year}-${letter}`,
        departmentCode: d.code,
        year,
        letter,
        label: `${year}-${d.code}-${letter}`,
        batch: `${batch.start}–${batch.start + (d.years === 4 ? 4 : 2)}`,
      };
    }),
  ),
);

/** Students per section: CSE sections are larger. */
export function sectionStrength(departmentCode: string): number {
  return departmentCode === "CSE" ? 14 : 10;
}

/** Roll numbers of a section's synthetic students, in seat order: admission year + department + sequence. */
export function rollNumbers(section: Section): string[] {
  const dept = DEPARTMENTS.find((d) => d.code === section.departmentCode)!;
  const perSection = sectionStrength(dept.code);
  const sectionIndex = dept.sections.indexOf(section.letter);
  const start = BATCH_BY_YEAR[section.year]!.start;
  return Array.from(
    { length: perSection },
    (_, i) =>
      `${String(start).slice(2)}${dept.code}${String(sectionIndex * perSection + i + 1).padStart(3, "0")}`,
  );
}

/** Stable record id of a synthetic student (the seed writes the same id). */
export const studentIdFor = (studentNumber: string) => syntheticUuid(studentNumber);
