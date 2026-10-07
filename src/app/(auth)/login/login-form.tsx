"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { signInAsPersona, type SignInState } from "@/app/actions/session";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

interface PersonaOption {
  email: string;
  name: string;
  title: string;
  role: string;
  tenant: string;
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export function LoginForm({
  googleEnabled,
  personas,
}: {
  googleEnabled: boolean;
  personas: PersonaOption[];
}) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAsPersona, {});
  const [selected, setSelected] = useState(personas[0]?.email ?? "");
  const [redirecting, setRedirecting] = useState(false);

  const google = async () => {
    setRedirecting(true);
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/dashboard",
      errorCallbackURL: "/login",
    });
    if (error) setRedirecting(false);
  };

  return (
    <div className="mt-6 space-y-6">
      <div>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={google}
          disabled={!googleEnabled || redirecting}
        >
          {redirecting ? <Loader2 className="animate-spin" /> : <GoogleMark />}
          Continue with Google
        </Button>
        {!googleEnabled && (
          <p className="text-subtle mt-2 text-xs">
            Google sign-in isn&apos;t configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
          </p>
        )}
      </div>

      {personas.length > 0 && (
        <>
          <div className="text-2xs text-subtle flex items-center gap-3 tracking-wide uppercase">
            <span className="bg-border h-px flex-1" />
            Demo accounts · synthetic data
            <span className="bg-border h-px flex-1" />
          </div>
          <form action={action} className="space-y-3">
            <fieldset disabled={pending}>
              <legend className="sr-only">Demo accounts</legend>
              <div role="radiogroup" className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
                {personas.map((p) => {
                  const checked = selected === p.email;
                  return (
                    <label
                      key={p.email}
                      className={cn(
                        "bg-surface has-[:focus-visible]:ring-ring/40 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 shadow-xs transition-colors has-[:focus-visible]:ring-2",
                        checked
                          ? "border-brand ring-brand ring-1"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name="email"
                        value={p.email}
                        checked={checked}
                        onChange={() => setSelected(p.email)}
                        className="sr-only"
                      />
                      <Avatar name={p.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="text-muted block truncate text-xs">{p.title}</span>
                      </span>
                      <span className="hidden shrink-0 text-right sm:block">
                        <span className="text-2xs text-foreground block font-medium">{p.role}</span>
                        <span className="text-2xs text-subtle block">{p.tenant}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {state.error && (
              <p
                role="alert"
                className="bg-danger-soft text-danger-soft-foreground rounded-md px-3 py-2 text-sm"
              >
                {state.error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={pending || !selected}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Continue as demo user
              {!pending && <ArrowRight />}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
