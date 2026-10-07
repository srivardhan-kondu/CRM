"use server";

import { z } from "zod";
import { ask, type AssistantAnswer } from "@/domains/assistant/answer";
import { currentAuth } from "@/lib/authz/context";

/** Ask CampusOS. Re-authenticates on every question; answers come from the same scoped queries as the pages. */
export async function askAction(question: string): Promise<AssistantAnswer | { error: string }> {
  const authed = await currentAuth();
  if (!authed) return { error: "Your session has ended. Sign in again." };
  const parsed = z.string().trim().min(2).max(200).safeParse(question);
  if (!parsed.success) return { error: "Ask a question of up to 200 characters." };
  return ask(authed, parsed.data);
}
