import { createHmac } from "node:crypto";

/**
 * Demo personas sign in with a password derived from the deployment secret, so the credential is never
 * published in the repository and differs per environment. Only used when CAMPUSOS_DEMO_MODE=true.
 */
export function demoPasswordFor(emailAddress: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`campusos-demo:${emailAddress.toLowerCase()}`)
    .digest("base64url")
    .slice(0, 32);
}
