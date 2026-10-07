"use client";

import { createAuthClient } from "better-auth/react";

/** Browser auth client — same-origin, so no baseURL is needed. */
export const authClient = createAuthClient();
