/**
 * SYNTHETIC DEMO DATA — guardian contact details, guardian messages and reading behaviour for the Communication Hub.
 * Deterministic, so the seed and tests agree. Every address is on a fictitious demo domain.
 */
import { DEMO_NOW, hash, rng } from "./base";
import { STUDENTS } from "./fixtures";

const demoStudent = STUDENTS.find((s) => s.sectionId === "CSE-3-A")!;

/** The parent persona's address (personas.ts) — their guardian record carries it so the two agree. */
export const PARENT_PERSONA_EMAIL = `guardian.${demoStudent.studentNumber.toLowerCase()}@demo.campusos.dev`;

/** About one guardian in eight has no email on record — the gap the delivery log and composer make visible. */
export function guardianEmailFor(studentNumber: string): string | null {
  if (studentNumber === demoStudent.studentNumber) return PARENT_PERSONA_EMAIL;
  return hash(`guardian-email:${studentNumber}`) % 100 < 88
    ? `guardian.${studentNumber.toLowerCase()}@family.demo.campusos.dev`
    : null;
}

const HOUR = 60 * 60 * 1000;

/**
 * When (if ever) a recipient read and acknowledged a seeded notice: older notices are read more widely; guardians read
 * less than students. The demo personas have read nothing from the last two days, so their inbox shows new notices.
 */
export function syntheticReceipt(
  noticeId: string,
  key: string,
  publishedAt: string,
  requiresAck: boolean,
  persona: boolean,
): { readAt: Date | null; acknowledgedAt: Date | null } {
  const published = new Date(publishedAt).getTime();
  const ageHours = (DEMO_NOW.getTime() - published) / HOUR;
  if (persona && ageHours < 48) return { readAt: null, acknowledgedAt: null };
  const r = rng(hash(`receipt:${noticeId}:${key}`));
  const guardian = key.startsWith("g:");
  const reach = Math.min(0.93, 0.3 + (ageHours / 24) * 0.16) * (guardian ? 0.62 : 1);
  if (!persona && r() > reach) return { readAt: null, acknowledgedAt: null };
  const readAt = new Date(
    Math.min(DEMO_NOW.getTime() - HOUR, published + (0.2 + r() * Math.max(1, ageHours * 0.6)) * HOUR),
  );
  const acked = requiresAck && (persona || r() < 0.82);
  return {
    readAt,
    acknowledgedAt: acked
      ? new Date(Math.min(DEMO_NOW.getTime() - HOUR, readAt.getTime() + r() * 6 * HOUR))
      : null,
  };
}

export interface SeedGuardianMessage {
  studentNumber: string;
  /** Persona who sent it (personas.ts). */
  senderKey: "class_incharge" | "hod_cse";
  senderName: string;
  senderRole: string;
  template: "attendance_shortage" | "meeting";
  sentAt: string;
  read: boolean;
  acknowledgedAt: string | null;
  reply: string | null;
}

const REPLIES = [
  "He had viral fever for a week; we will send the doctor's certificate to the class incharge.",
  "Thank you for informing us. We will make sure she attends every class.",
  "We were not aware. I will come to the college on Saturday to meet you.",
];

const shortageIn = (sectionId: string) =>
  STUDENTS.filter(
    (s) => s.sectionId === sectionId && s.status === "active" && s.attendancePct < s.attendanceThreshold,
  )
    .filter((s) => s.studentNumber !== demoStudent.studentNumber)
    .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber));

/**
 * The HOD told the guardians of 3-CSE-B's shortage list on 30 September. Ms. Kavya Nair told 3-CSE-A's on 15
 * September — more than a fortnight ago, so they are suggested again. The parent persona received a meeting request
 * last night at 21:40, inside quiet hours, so its email waits for 07:00.
 */
export function seedGuardianMessages(): SeedGuardianMessage[] {
  const batch = (
    students: ReturnType<typeof shortageIn>,
    sender: Pick<SeedGuardianMessage, "senderKey" | "senderName" | "senderRole">,
    sentAt: string,
    ackOn: string,
  ): SeedGuardianMessage[] =>
    students.map((s, i) => {
      const r = rng(hash(`gm:${s.studentNumber}`));
      const read = i === 0 || r() < 0.85;
      const acked = i === 0 || (read && r() < 0.75);
      return {
        ...sender,
        studentNumber: s.studentNumber,
        template: "attendance_shortage",
        sentAt,
        read,
        acknowledgedAt: acked ? `${ackOn}T19:${String(10 + i).padStart(2, "0")}:00+05:30` : null,
        reply: acked && i % 2 === 0 ? REPLIES[i % REPLIES.length]! : null,
      };
    });
  return [
    ...batch(
      shortageIn("CSE-3-A"),
      { senderKey: "class_incharge", senderName: "Ms. Kavya Nair", senderRole: "Class Incharge" },
      "2026-09-15T16:30:00+05:30",
      "2026-09-16",
    ),
    ...batch(
      shortageIn("CSE-3-B"),
      { senderKey: "hod_cse", senderName: "Prof. Arvind Kulkarni", senderRole: "Head of Department" },
      "2026-09-30T16:30:00+05:30",
      "2026-10-02",
    ),
    {
      studentNumber: demoStudent.studentNumber,
      senderKey: "class_incharge",
      senderName: "Ms. Kavya Nair",
      senderRole: "Class Incharge",
      template: "meeting",
      sentAt: "2026-10-05T21:40:00+05:30",
      read: false,
      acknowledgedAt: null,
      reply: null,
    },
  ];
}
