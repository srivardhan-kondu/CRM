/**
 * SYNTHETIC academic structure for the demo tenant: programmes, regulations (curriculum versions), the course
 * catalogue, batches, terms, faculty and teaching allocations. The seed writes these into Neon; unit tests read
 * them directly. Every person here is fictitious.
 *
 * Odd-semester course lists come from fixtures.ts (the courses current students take this term); even
 * semesters are defined here so every regulation is complete.
 */
import { semesterFor } from "@/domains/academics/plan";
import { BATCH_BY_YEAR, COURSES, DEPARTMENTS, FACULTY_BY_DEPT, hash, pick, rng, SECTIONS } from "./base";

type CourseRow = [code: string, name: string];

export interface ProgrammeSpec {
  code: string;
  name: string;
  departmentCode: string;
  level: "ug" | "pg";
  durationYears: number;
  semesters: number;
}

export const PROGRAMMES: ProgrammeSpec[] = DEPARTMENTS.map((d) => ({
  code: d.years === 4 ? `BTECH-${d.code}` : d.code,
  name: d.programme,
  departmentCode: d.code,
  level: d.years === 4 ? "ug" : "pg",
  durationYears: d.years,
  semesters: d.years * 2,
}));

export function programmeForDepartment(departmentCode: string): ProgrammeSpec {
  return PROGRAMMES.find((p) => p.departmentCode === departmentCode)!;
}

const EVEN_SEMESTERS: Record<string, Record<number, CourseRow[]>> = {
  CSE: {
    2: [
      ["MA102", "Engineering Mathematics II"],
      ["CH101", "Engineering Chemistry"],
      ["CS102", "Problem Solving with Python"],
      ["ME101", "Engineering Graphics"],
      ["CS103", "Programming Lab"],
    ],
    4: [
      ["CS206", "Computer Organisation & Architecture"],
      ["CS207", "Theory of Computation"],
      ["CS208", "Web Programming"],
      ["CS209", "Microprocessors & Interfacing"],
      ["HS201", "Universal Human Values"],
    ],
    6: [
      ["CS306", "Compiler Design"],
      ["CS307", "Artificial Intelligence"],
      ["CS308", "Mobile Computing"],
      ["CS309", "Data Mining"],
      ["CS310", "Mini Project"],
    ],
    8: [
      ["CS406", "Big Data Analytics"],
      ["CS407", "Blockchain Technology"],
      ["HS401", "Entrepreneurship"],
      ["CS408", "Major Project II"],
    ],
  },
  ECE: {
    2: [
      ["MA102", "Engineering Mathematics II"],
      ["CH101", "Engineering Chemistry"],
      ["EC102", "Circuit Theory"],
      ["ME101", "Engineering Graphics"],
      ["EC103", "Electronics Workshop"],
    ],
    4: [
      ["EC205", "Analog Circuits"],
      ["EC206", "Communication Theory"],
      ["EC207", "Computer Architecture"],
      ["EC208", "Electronic Measurements"],
      ["HS201", "Universal Human Values"],
    ],
    6: [
      ["EC306", "Digital Signal Processing"],
      ["EC307", "Antennas & Wave Propagation"],
      ["EC308", "Digital Communication"],
      ["EC309", "IoT Systems"],
      ["EC310", "Mini Project"],
    ],
    8: [
      ["EC406", "Satellite Communication"],
      ["EC407", "Radar Systems"],
      ["HS401", "Entrepreneurship"],
      ["EC408", "Major Project II"],
    ],
  },
  EEE: {
    2: [
      ["MA102", "Engineering Mathematics II"],
      ["PH101", "Engineering Physics"],
      ["EE102", "Network Analysis"],
      ["CS102", "Problem Solving with Python"],
      ["EE103", "Electrical Workshop"],
    ],
    4: [
      ["EE205", "Power Generation"],
      ["EE206", "Digital Electronics"],
      ["EE207", "Signals & Systems"],
      ["EE208", "Electrical Measurements Lab"],
      ["HS201", "Universal Human Values"],
    ],
    6: [
      ["EE306", "Power System Protection"],
      ["EE307", "Microcontrollers"],
      ["EE308", "Utilisation of Electrical Energy"],
      ["EE309", "Digital Control Systems"],
      ["EE310", "Mini Project"],
    ],
    8: [
      ["EE406", "Smart Grid"],
      ["EE407", "HVDC Transmission"],
      ["HS401", "Entrepreneurship"],
      ["EE408", "Major Project II"],
    ],
  },
  MECH: {
    2: [
      ["MA102", "Engineering Mathematics II"],
      ["CH101", "Engineering Chemistry"],
      ["ME103", "Computer-Aided Drafting"],
      ["CS102", "Problem Solving with Python"],
      ["EE101", "Basic Electrical Engineering"],
    ],
    4: [
      ["ME205", "Strength of Materials"],
      ["ME206", "Fluid Mechanics"],
      ["ME207", "Kinematics of Machinery"],
      ["ME208", "Machine Drawing"],
      ["HS201", "Universal Human Values"],
    ],
    6: [
      ["ME306", "Refrigeration & Air Conditioning"],
      ["ME307", "Mechatronics"],
      ["ME308", "Operations Research"],
      ["ME309", "Robotics"],
      ["ME310", "Mini Project"],
    ],
    8: [
      ["ME406", "Additive Manufacturing"],
      ["ME407", "Power Plant Engineering"],
      ["HS401", "Entrepreneurship"],
      ["ME408", "Major Project II"],
    ],
  },
  MBA: {
    2: [
      ["MB106", "Financial Management"],
      ["MB107", "Operations Management"],
      ["MB108", "Marketing Research"],
      ["MB109", "Business Law"],
      ["MB110", "Management Information Systems"],
    ],
    4: [
      ["MB206", "International Business"],
      ["MB207", "Entrepreneurship Development"],
      ["MB208", "Supply Chain Management"],
      ["MB209", "Business Ethics"],
      ["MB210", "Dissertation"],
    ],
  },
  MCA: {
    2: [
      ["CA106", "Operating Systems"],
      ["CA107", "Object-Oriented Programming with Java"],
      ["CA108", "Computer Networks"],
      ["CA109", "Software Engineering"],
      ["CA110", "Algorithms Lab"],
    ],
    4: [
      ["CA206", "Big Data Analytics"],
      ["CA207", "Cyber Security"],
      ["CA208", "DevOps"],
      ["CA209", "Technical Seminar"],
      ["CA210", "Industry Internship"],
    ],
  },
};

/** R24 revises the final-year electives of each B.Tech programme; earlier semesters are unchanged from R22. */
const R24_SUBSTITUTIONS: Record<string, Record<string, CourseRow>> = {
  CSE: { CS404: ["CS409", "Generative AI Systems"], CS407: ["CS410", "MLOps & Responsible AI"] },
  ECE: { EC404: ["EC409", "5G Networks"], EC407: ["EC410", "Edge AI Hardware"] },
  EEE: { EE404: ["EE409", "Electric Vehicle Technology"], EE407: ["EE410", "Energy Storage Systems"] },
  MECH: { ME402: ["ME409", "Electric Vehicle Design"], ME407: ["ME410", "Industry 4.0"] },
};

export interface CourseSpec {
  code: string;
  name: string;
  /** Org unit code that owns the course: a department, or the school for shared foundation courses. */
  ownerCode: string;
  type: "theory" | "lab" | "project";
  credits: number;
  lectureHours: number;
  tutorialHours: number;
  practicalHours: number;
}

const OWNER_BY_PREFIX: Record<string, string> = {
  CS: "CSE",
  EC: "ECE",
  EE: "EEE",
  ME: "MECH",
  MB: "MBA",
  CA: "MCA",
  MA: "ENG",
  PH: "ENG",
  CH: "ENG",
  HS: "ENG",
};

/** Credit and contact-hour pattern derived from the course name — a stand-in for an approved syllabus. */
export function courseSpec([code, name]: CourseRow): CourseSpec {
  const ownerCode = OWNER_BY_PREFIX[code.slice(0, 2)] ?? "ENG";
  if (/Lab|Workshop|Practice/.test(name))
    return {
      code,
      name,
      ownerCode,
      type: "lab",
      credits: 2,
      lectureHours: 0,
      tutorialHours: 0,
      practicalHours: 4,
    };
  if (/Project|Internship|Dissertation|Report|Seminar/.test(name)) {
    const credits = /Major|Dissertation|Internship/.test(name) ? 6 : 3;
    return {
      code,
      name,
      ownerCode,
      type: "project",
      credits,
      lectureHours: 0,
      tutorialHours: 0,
      practicalHours: credits,
    };
  }
  if (code.startsWith("MA"))
    return {
      code,
      name,
      ownerCode,
      type: "theory",
      credits: 4,
      lectureHours: 3,
      tutorialHours: 1,
      practicalHours: 0,
    };
  return {
    code,
    name,
    ownerCode,
    type: "theory",
    credits: 3,
    lectureHours: 3,
    tutorialHours: 0,
    practicalHours: 0,
  };
}

export type CategorySpec = "core" | "elective" | "lab" | "project" | "foundation";

export interface CurriculumEntry {
  code: string;
  semester: number;
  category: CategorySpec;
}

export interface RegulationSpec {
  programmeCode: string;
  code: string;
  name: string;
  status: "draft" | "active" | "retired";
  effectiveFromYear: number;
  derivedFrom: string | null;
  courses: CurriculumEntry[];
}

function category(spec: CourseSpec, semester: number, index: number): CategorySpec {
  if (spec.type === "lab") return "lab";
  if (spec.type === "project") return "project";
  if (semester <= 2 && spec.ownerCode === "ENG") return "foundation";
  if (semester >= 7 && index >= 2) return "elective";
  return "core";
}

function semesterRows(departmentCode: string, semester: number): CourseRow[] {
  if (semester % 2 === 1) return COURSES[`${departmentCode}-${(semester + 1) / 2}`] ?? [];
  return EVEN_SEMESTERS[departmentCode]?.[semester] ?? [];
}

function regulationCourses(p: ProgrammeSpec, substitute: Record<string, CourseRow> = {}): CurriculumEntry[] {
  const out: CurriculumEntry[] = [];
  for (let sem = 1; sem <= p.semesters; sem++) {
    semesterRows(p.departmentCode, sem).forEach((row, i) => {
      const actual = substitute[row[0]] ?? row;
      out.push({ code: actual[0], semester: sem, category: category(courseSpec(actual), sem, i) });
    });
  }
  return out;
}

/**
 * B.Tech programmes: R22 (2022–2023 admissions) and R24 (2024 onwards, revised final-year electives).
 * PG programmes: R24 only. B.Tech CSE also has an R26 draft under revision, to show the draft workflow.
 */
export const REGULATIONS: RegulationSpec[] = PROGRAMMES.flatMap((p) => {
  const r24: RegulationSpec = {
    programmeCode: p.code,
    code: "R24",
    name: `${p.name} Regulation 2024`,
    status: "active",
    effectiveFromYear: 2024,
    derivedFrom: p.level === "ug" ? "R22" : null,
    courses: regulationCourses(p, R24_SUBSTITUTIONS[p.departmentCode]),
  };
  if (p.level !== "ug") return [r24];
  const r22: RegulationSpec = {
    programmeCode: p.code,
    code: "R22",
    name: `${p.name} Regulation 2022`,
    status: "active",
    effectiveFromYear: 2022,
    derivedFrom: null,
    courses: regulationCourses(p),
  };
  const drafts: RegulationSpec[] =
    p.departmentCode === "CSE"
      ? [
          {
            programmeCode: p.code,
            code: "R26",
            name: `${p.name} Regulation 2026 (under revision)`,
            status: "draft",
            effectiveFromYear: 2026,
            derivedFrom: "R24",
            courses: r24.courses,
          },
        ]
      : [];
  return [r22, r24, ...drafts];
});

/** Every distinct course across all regulations, keyed by code (one name and credit pattern per code). */
export const COURSE_CATALOGUE: CourseSpec[] = (() => {
  const rows = new Map<string, CourseRow>();
  const add = (row: CourseRow) => {
    const existing = rows.get(row[0]);
    if (existing && existing[1] !== row[1])
      throw new Error(`Course ${row[0]} has two names: "${existing[1]}" and "${row[1]}"`);
    rows.set(row[0], row);
  };
  Object.values(COURSES).flat().forEach(add);
  Object.values(EVEN_SEMESTERS).forEach((sems) => Object.values(sems).flat().forEach(add));
  Object.values(R24_SUBSTITUTIONS).forEach((subs) => Object.values(subs).forEach(add));
  return [...rows.values()].map(courseSpec).sort((a, b) => a.code.localeCompare(b.code));
})();

export interface BatchSpec {
  code: string;
  name: string;
  programmeCode: string;
  regulationCode: string;
  admissionYear: number;
  graduationYear: number;
}

export const BATCHES: BatchSpec[] = PROGRAMMES.flatMap((p) =>
  Array.from({ length: p.durationYears }, (_, i) => {
    const admissionYear = BATCH_BY_YEAR[i + 1]!.start;
    const graduationYear = admissionYear + p.durationYears;
    return {
      code: `${p.code}-${admissionYear}`,
      name: `${p.name} ${admissionYear}–${String(graduationYear).slice(2)}`,
      programmeCode: p.code,
      regulationCode: p.level === "ug" && admissionYear < 2024 ? "R22" : "R24",
      admissionYear,
      graduationYear,
    };
  }),
);

export function batchForSection(sectionCode: string): BatchSpec {
  const section = SECTIONS.find((s) => s.id === sectionCode)!;
  const p = programmeForDepartment(section.departmentCode);
  return BATCHES.find(
    (b) => b.programmeCode === p.code && b.admissionYear === BATCH_BY_YEAR[section.year]!.start,
  )!;
}

export interface TermSpec {
  code: string;
  name: string;
  kind: "odd" | "even";
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

export const ACADEMIC_YEAR = { code: "2026-27", startsOn: "2026-06-15", endsOn: "2027-05-31" } as const;

export const TERMS: TermSpec[] = [
  {
    code: "2026-27-ODD",
    name: "Odd semester 2026–27",
    kind: "odd",
    startsOn: "2026-07-01",
    endsOn: "2026-11-30",
    isCurrent: true,
  },
  {
    code: "2026-27-EVEN",
    name: "Even semester 2026–27",
    kind: "even",
    startsOn: "2026-12-14",
    endsOn: "2027-05-15",
    isCurrent: false,
  },
];

/* ---------- Faculty ---------- */

export interface FacultySpec {
  name: string;
  email: string;
  employeeCode: string;
  designation: string;
  departmentCode: string;
  maxWeeklyHours: number;
  joinedOn: string;
}

/** Faculty who are also demo personas keep their persona login email. */
const PERSONA_FACULTY: Record<string, string> = {
  "Ms. Kavya Nair": "kavya.nair@demo.campusos.dev",
  "Mr. Rahul Verma": "rahul.verma@demo.campusos.dev",
  "Dr. Sunita Menon": "pc.btech.cse@demo.campusos.dev",
  "Prof. Arvind Kulkarni": "hod.cse@demo.campusos.dev",
};

/** Extra synthetic faculty so departments can staff every offering at a realistic load. */
const EXTRA_FACULTY: Record<string, number> = { CSE: 11, ECE: 6, EEE: 7, MECH: 7, MBA: 4, MCA: 4 };
const TITLES = ["Dr.", "Dr.", "Prof."];
const EXTRA_FIRST = [
  "Anand",
  "Bhavna",
  "Chetan",
  "Deepa",
  "Gaurav",
  "Hema",
  "Jayant",
  "Kiran",
  "Lata",
  "Mohan",
  "Nisha",
  "Om",
  "Prakash",
  "Rekha",
  "Sameer",
  "Uma",
  "Vinay",
];
const EXTRA_LAST = [
  "Acharya",
  "Bhat",
  "Desai",
  "Gowda",
  "Jain",
  "Kamath",
  "Mishra",
  "Nambiar",
  "Prasad",
  "Saxena",
  "Tiwari",
  "Varma",
];

function designationFor(name: string, isHead: boolean): string {
  if (isHead) return "Professor & Head";
  if (name.startsWith("Prof.")) return "Professor";
  if (name.startsWith("Dr.")) return "Associate Professor";
  return "Assistant Professor";
}

function localPart(name: string): string {
  return name
    .replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+/, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".");
}

export const FACULTY: FacultySpec[] = DEPARTMENTS.flatMap((d) => {
  const named = [...(d.code === "CSE" ? ["Prof. Arvind Kulkarni"] : []), ...(FACULTY_BY_DEPT[d.code] ?? [])];
  const r = rng(hash(`faculty:${d.code}`));
  const extra: string[] = [];
  while (extra.length < (EXTRA_FACULTY[d.code] ?? 0)) {
    const candidate = `${pick(r, TITLES)} ${pick(r, EXTRA_FIRST)} ${pick(r, EXTRA_LAST)}`;
    const key = localPart(candidate);
    if (![...named, ...extra].some((n) => localPart(n) === key)) extra.push(candidate);
  }
  return [...named, ...extra].map((name, i) => ({
    name,
    email: PERSONA_FACULTY[name] ?? `${localPart(name)}@demo.campusos.dev`,
    employeeCode: `F${d.code}${String(i + 1).padStart(3, "0")}`,
    designation: designationFor(name, name === "Prof. Arvind Kulkarni"),
    departmentCode: d.code,
    maxWeeklyHours: name === "Prof. Arvind Kulkarni" ? 6 : 16,
    joinedOn: `${2008 + Math.floor(r() * 16)}-0${1 + Math.floor(r() * 8)}-01`,
  }));
});

/* ---------- Offerings and allocations for the current term ---------- */

export interface OfferingSpec {
  termCode: string;
  sectionCode: string;
  courseCode: string;
  /** Faculty name, or null for an offering still waiting for a teacher. */
  facultyName: string | null;
}

/**
 * Persona teaching, scripted so their scope is stable: everything else is allocated by load. The programme
 * coordinator and HOD teach nothing, so revoking their role (Phase 1 E2E) leaves them with no access at all.
 */
const SCRIPTED: Record<string, string> = {
  "CSE-3-A/CS301": "Mr. Rahul Verma",
  "CSE-3-B/CS301": "Mr. Rahul Verma",
  "CSE-3-A/CS302": "Ms. Kavya Nair",
  "CSE-3-B/CS302": "Ms. Kavya Nair",
  // Not persona-scoped, but scripted so today's synthetic timetable (fixtures.ts) names the allocated teacher.
  "CSE-3-A/CS303": "Mr. Karthik Rao",
  "CSE-3-A/CS304": "Mr. Imran Qureshi",
  "CSE-3-B/CS305": "Dr. Pooja Bhatt",
};
const PERSONA_NAMES = new Set(Object.keys(PERSONA_FACULTY));
/** Deliberate gaps so the "unallocated" state is visible. */
const UNALLOCATED = new Set(["CSE-3-C/CS305", "ECE-2-B/EC203", "MECH-4-A/ME405"]);

function weeklyHours(c: CourseSpec) {
  return c.lectureHours + c.tutorialHours + c.practicalHours;
}

/**
 * Offerings for the current (odd) term: every section takes its regulation's courses for the semester it is in.
 * Persona teaching is scripted; the rest is allocated by load within the section's department.
 */
export function currentTermOfferings(): OfferingSpec[] {
  const term = TERMS.find((t) => t.isCurrent)!;
  const yearStart = Number(ACADEMIC_YEAR.code.slice(0, 4));
  const catalogue = new Map(COURSE_CATALOGUE.map((c) => [c.code, c]));
  const out: OfferingSpec[] = [];
  for (const section of [...SECTIONS].sort((a, b) => a.id.localeCompare(b.id))) {
    const b = batchForSection(section.id);
    const reg = REGULATIONS.find((r) => r.programmeCode === b.programmeCode && r.code === b.regulationCode)!;
    const sem = semesterFor(b.admissionYear, yearStart, term.kind);
    for (const entry of reg.courses.filter((c) => c.semester === sem)) {
      const key = `${section.id}/${entry.code}`;
      out.push({
        termCode: term.code,
        sectionCode: section.id,
        courseCode: entry.code,
        facultyName: SCRIPTED[key] ?? null,
      });
    }
  }

  // Longest offerings first, each to the least-loaded colleague in the section's department (LPT scheduling),
  // which keeps everyone close to an even share.
  const load = new Map<string, number>();
  const hours = (o: OfferingSpec) => weeklyHours(catalogue.get(o.courseCode)!);
  for (const o of out) if (o.facultyName) load.set(o.facultyName, (load.get(o.facultyName) ?? 0) + hours(o));
  const queue = out
    .filter((o) => !o.facultyName && !UNALLOCATED.has(`${o.sectionCode}/${o.courseCode}`))
    .sort(
      (x, y) =>
        hours(y) - hours(x) ||
        `${x.sectionCode}/${x.courseCode}`.localeCompare(`${y.sectionCode}/${y.courseCode}`),
    );
  for (const o of queue) {
    const dept = SECTIONS.find((sec) => sec.id === o.sectionCode)!.departmentCode;
    const chosen = FACULTY.filter((f) => f.departmentCode === dept && !PERSONA_NAMES.has(f.name)).sort(
      (x, y) => (load.get(x.name) ?? 0) - (load.get(y.name) ?? 0) || x.name.localeCompare(y.name),
    )[0];
    if (!chosen) continue;
    o.facultyName = chosen.name;
    load.set(chosen.name, (load.get(chosen.name) ?? 0) + hours(o));
  }
  return out;
}
