# Forgot Password / Reset Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any account (employee or admin) self-recover a forgotten password via an emailed 6-digit code, with the same defense-in-depth lockout the codebase already uses for login, plus full session revocation on success.

**Architecture:** Two new public TanStack Router routes (`/forgot-password`, `/reset-password`) built entirely on Supabase Auth's native OTP recovery flow (`resetPasswordForEmail` / `verifyOtp` / `updateUser`), backed by one new server-function file (`src/lib/password-reset.functions.ts`) that adds a per-email attempt lockout (mirroring `login.functions.ts`) and a global session-revocation call. One new DB table, no new dependencies.

**Tech Stack:** TanStack Start/Router (file-based routes), Supabase JS v2 (`@supabase/supabase-js`), Zod, Sonner (toasts), Bun (`bunx tsc --noEmit` for typechecking — no test runner applies to these files since they need a live Supabase project, matching how `login.functions.ts` has no unit test either).

## Global Constraints

- Lockout constants: `FAILURE_THRESHOLD = 5`, `WINDOW_MINUTES = 15`, `LOCKOUT_MINUTES = 15` — copied verbatim from `login.functions.ts`, not re-tuned (spec section B justifies why 5/15/15 is already sufficient for a 6-digit code).
- New table: `public.password_reset_attempts` with columns `id, email, ip_address, success, created_at`, RLS enabled with **zero policies** (service-role-only access, same as `login_attempts`).
- New server functions live in `src/lib/password-reset.functions.ts`: `verifyResetCode` and `revokeAllSessions`. No other file may contain this logic.
- New routes: `/forgot-password` and `/reset-password`, both public (no `RoleGuard`), siblings of `/auth`.
- Password rule: `min(6).max(72)` — identical to the existing rule in `auth.tsx`.
- Supabase OTP type used throughout is `"recovery"` (both `resetPasswordForEmail` and `verifyOtp`).
- On successful password update, call `supabaseAdmin.auth.admin.signOut(accessToken, "global")` before signing out client-side. Never auto-log-in after a reset — always end at `/auth`.
- Every response on the request step (`/forgot-password`) is identical regardless of whether the email has an account. Every failure on the verify step is the generic message `"Invalid or expired code."` (never distinguishes wrong code vs. wrong email vs. expired).
- Reuse the existing `TurnstileWidget` (`src/components/turnstile-widget.tsx`) on both the initial request and any resend — no new CAPTCHA component.

---

### Task 1: Database — `password_reset_attempts` table

**Files:**
- Create: `supabase/migrations/20260706160000_f1a2b3c4-6666-4f6a-8b7c-4d5e6f7a8b9c.sql`
- Modify: `src/integrations/supabase/types.ts:386-387`

**Interfaces:**
- Produces: a `password_reset_attempts` table queryable via `supabaseAdmin.from("password_reset_attempts")` with `Row: { id: string, email: string, ip_address: string | null, success: boolean, created_at: string }`, used by Task 2.

This table is normally auto-regenerated into `types.ts` by `supabase gen types` after a migration is applied to the live project. Since this environment has no Supabase CLI/credentials to push migrations live (same situation the sync-check spec's Task 3 was in — "migration file committed, NOT yet applied to live DB, requires user action"), this task hand-adds the matching type block so the code in later tasks compiles now, and applying the migration + regenerating types for real is called out as a required manual step.

- [ ] **Step 1: Write the migration**

```sql
-- Fix for [forgot/reset password] design — Layer 2: app-side attempt lockout
-- on the emailed reset code, mirroring the login_attempts pattern added for
-- Vulnerability Report finding #1.
--
-- This table is written to exclusively by the server (service-role client) via
-- the `verifyResetCode` server function — never by the browser directly. RLS is
-- enabled with zero policies for anon/authenticated, so even if someone got a
-- hold of the publishable key + a JWT, they cannot read or write this table
-- over the REST API.

CREATE TABLE IF NOT EXISTS public.password_reset_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address text,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_email_time
  ON public.password_reset_attempts (lower(email), created_at DESC);

ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: default-deny for anon/authenticated. Only
-- service_role (which bypasses RLS) may read/write, via the
-- verifyResetCode server function.
```

- [ ] **Step 2: Hand-add the matching type block to `types.ts`**

Find this exact text at `src/integrations/supabase/types.ts:385-387`:

```ts
        Relationships: []
      }
      payroll: {
```

Replace with:

```ts
        Relationships: []
      }
      password_reset_attempts: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_address: string | null
          success: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_address?: string | null
          success: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_address?: string | null
          success?: boolean
        }
        Relationships: []
      }
      payroll: {
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors introduced (this codebase has 3 pre-existing unrelated `users.functions.ts` errors — ignore those, same baseline noted in the sync-check plan's verification).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260706160000_f1a2b3c4-6666-4f6a-8b7c-4d5e6f7a8b9c.sql src/integrations/supabase/types.ts
git commit -m "Add password_reset_attempts table for reset-code lockout"
```

- [ ] **Step 5: Flag manual DB action (do not skip)**

This migration is **not yet applied to the live database**. Before Task 6's live verification can pass, apply it via the Supabase Dashboard's SQL editor (paste the contents of the migration file and run it) or `supabase db push` if the CLI is linked locally, then regenerate `types.ts` for real (`supabase gen types typescript --project-id <id> > src/integrations/supabase/types.ts`) so the hand-added block in Step 2 is replaced by the authoritative generated one.

---

### Task 2: Backend — `verifyResetCode` and `revokeAllSessions` server functions

**Files:**
- Modify: `src/lib/login.functions.ts:24-33` (export the existing `getClientIp` helper)
- Create: `src/lib/password-reset.functions.ts`

**Interfaces:**
- Consumes: `getClientIp(): string | null` (exported from `login.functions.ts`); `Database` type from `@/integrations/supabase/types`; `supabaseAdmin` from `@/integrations/supabase/client.server`.
- Produces:
  - `verifyResetCode` — a `createServerFn` accepting `{ email: string, code: string }`, returning `{ access_token: string, refresh_token: string }` on success, throwing `Error` on failure. Consumed by Task 4 (`/reset-password`).
  - `revokeAllSessions` — a `createServerFn` accepting `{ accessToken: string }`, returning `{ ok: true }`. Consumed by Task 4.

- [ ] **Step 1: Export `getClientIp` from `login.functions.ts`**

In `src/lib/login.functions.ts`, change:

```ts
function getClientIp(): string | null {
```

to:

```ts
export function getClientIp(): string | null {
```

- [ ] **Step 2: Typecheck the export change**

Run: `bunx tsc --noEmit`
Expected: no new errors (same pre-existing baseline as Task 1 Step 3).

- [ ] **Step 3: Write `src/lib/password-reset.functions.ts`**

```ts
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { getClientIp } from "@/lib/login.functions";

// Layer 2 defense-in-depth against brute-forcing the emailed reset code,
// mirroring the login lockout in login.functions.ts (itself a fix for
// Vulnerability Report finding #1). Supabase's own single-use, expiring OTP
// is the primary defense; this adds a second, independent layer: per-email
// attempt lockout tracked in our own DB. 5 guesses per 15-minute window
// against a 6-digit (1,000,000-value) code is not practically brute-forceable.

const FAILURE_THRESHOLD = 5;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

const verifySchema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const verifyResetCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifySchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const ip = getClientIp();
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

    const { data: recentFailures, error: countErr } = await supabaseAdmin
      .from("password_reset_attempts")
      .select("id, created_at")
      .eq("email", email)
      .eq("success", false)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false });
    if (countErr) throw new Error("Reset temporarily unavailable, try again shortly");

    if ((recentFailures?.length ?? 0) >= FAILURE_THRESHOLD) {
      const mostRecent = new Date(recentFailures![0].created_at);
      const lockedUntil = new Date(mostRecent.getTime() + LOCKOUT_MINUTES * 60_000);
      if (lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
        throw new Error(`Too many attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`);
      }
    }

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const anon = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
      email: data.email,
      token: data.code,
      type: "recovery",
    });

    await supabaseAdmin.from("password_reset_attempts").insert({
      email,
      ip_address: ip,
      success: !verifyError,
    });

    if (verifyError || !verifyData.session) {
      throw new Error("Invalid or expired code.");
    }

    return {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    };
  });

const revokeSchema = z.object({
  accessToken: z.string().min(1),
});

export const revokeAllSessions = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => revokeSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.signOut(data.accessToken, "global");
    if (error) throw new Error("Could not fully revoke existing sessions");
    return { ok: true };
  });
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors beyond the same pre-existing baseline.

- [ ] **Step 5: Commit**

```bash
git add src/lib/login.functions.ts src/lib/password-reset.functions.ts
git commit -m "Add verifyResetCode and revokeAllSessions server functions"
```

---

### Task 3: Frontend — `/forgot-password` route

**Files:**
- Create: `src/routes/forgot-password.tsx`

**Interfaces:**
- Consumes: `supabase` client (`@/integrations/supabase/client`), `TurnstileWidget` (`@/components/turnstile-widget`), UI primitives already used by `auth.tsx` (`Button`, `Input`, `Label`, `Card`/`CardContent`/`CardDescription`/`CardHeader`/`CardTitle` from `@/components/ui/*`).
- Produces: route `/forgot-password`, navigable via `navigate({ to: "/forgot-password" })`, and on success navigates to `/reset-password` with `search: { email }` — the shape Task 4's route reads via `validateSearch`.

- [ ] **Step 1: Write `src/routes/forgot-password.tsx`**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
});

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot password · MySocLabs Attendance" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handle = async () => {
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        captchaToken: captchaToken ?? undefined,
      });
    } finally {
      // Always show the same outcome, whether or not the email has an
      // account and regardless of any error Supabase returns, so this step
      // can never be used to enumerate which emails have accounts.
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <h1 className="text-2xl font-semibold tracking-tight">MySocLabs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Attendance System · Admin Portal</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Forgot password</CardTitle>
            <CardDescription>
              {sent
                ? "If that email has an account, we've sent a 6-digit reset code."
                : "Enter your account email and we'll send you a reset code."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!sent ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="admin@mysoclabs.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <TurnstileWidget onToken={setCaptchaToken} />
                <Button onClick={handle} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset code"}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => navigate({ to: "/reset-password", search: { email } })}
                className="w-full"
              >
                Enter code
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors beyond the pre-existing baseline.

- [ ] **Step 3: Start the dev server and confirm the route renders**

Run: `bun run dev` (leave running), then open `/forgot-password` in a browser.
Expected: the page renders the email form with the Turnstile widget (or no widget if `VITE_TURNSTILE_SITE_KEY` isn't set locally — that's the existing, already-accepted fallback behavior from `TurnstileWidget`), and submitting shows the generic "sent" message and an "Enter code" button. Stop the dev server after confirming.

- [ ] **Step 4: Commit**

```bash
git add src/routes/forgot-password.tsx
git commit -m "Add /forgot-password route"
```

---

### Task 4: Frontend — `/reset-password` route

**Files:**
- Create: `src/routes/reset-password.tsx`

**Interfaces:**
- Consumes: `verifyResetCode`, `revokeAllSessions` from `@/lib/password-reset.functions` (Task 2); `supabase` client; `TurnstileWidget`; same UI primitives as Task 3; reads `search.email` via `validateSearch` (populated by Task 3's navigation).
- Produces: route `/reset-password`, terminal navigation to `/auth` on success.

- [ ] **Step 1: Write `src/routes/reset-password.tsx`**

```tsx
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { verifyResetCode, revokeAllSessions } from "@/lib/password-reset.functions";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const codeSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const passwordSchema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters").max(72),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password · MySocLabs Attendance" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { email: initialEmail } = useSearch({ from: "/reset-password" });
  const verify = useServerFn(verifyResetCode);
  const revoke = useServerFn(revokeAllSessions);

  const [step, setStep] = useState<"code" | "password">("code");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (step !== "password") return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        toast.error("Your session expired, please request a new code.");
        setStep("code");
      }
    });
  }, [step]);

  const handleVerify = async () => {
    const parsed = codeSchema.safeParse({ email, code });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const { access_token, refresh_token } = await verify({ data: parsed.data });
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      setStep("password");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not verify code";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const parsed = z.string().trim().email("Enter a valid email").max(255).safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(parsed.data, {
        captchaToken: captchaToken ?? undefined,
      });
    } finally {
      setLoading(false);
      toast.success("If that email has an account, a new code is on its way.");
    }
  };

  const handleReset = async () => {
    const parsed = passwordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error("Your session expired, please request a new code.");
        setStep("code");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (updateError) throw updateError;
      await revoke({ data: { accessToken } });
      await supabase.auth.signOut();
      toast.success("Password updated — please log in.");
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update password";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <h1 className="text-2xl font-semibold tracking-tight">MySocLabs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Attendance System · Admin Portal</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
            <CardDescription>
              {step === "code" ? "Enter the 6-digit code we emailed you." : "Choose a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "code" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                </div>
                <TurnstileWidget onToken={setCaptchaToken} />
                <Button onClick={handleVerify} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify code"}
                </Button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={loading}
                  className="w-full text-sm text-muted-foreground hover:text-foreground"
                >
                  Didn't get a code? Resend
                </button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button onClick={handleReset} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset password"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors beyond the pre-existing baseline.

- [ ] **Step 3: Start the dev server and confirm the route renders**

Run: `bun run dev` (leave running), open `/reset-password?email=test%40example.com`.
Expected: Step 1 (code entry) renders with the email pre-filled. Stop the dev server after confirming — full functional verification (real code, real DB row) happens in Task 6 once the migration from Task 1 is applied live.

- [ ] **Step 4: Commit**

```bash
git add src/routes/reset-password.tsx
git commit -m "Add /reset-password route"
```

---

### Task 5: Login page — add "Forgot password?" link

**Files:**
- Modify: `src/routes/auth.tsx:1-9` (imports), `:95-116` (password field block)

**Interfaces:**
- Consumes: `Link` from `@tanstack/react-router`, navigating to `/forgot-password` (Task 3).

- [ ] **Step 1: Add `Link` to the router import**

Change:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
```

to:

```tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
```

- [ ] **Step 2: Add the link below the password field**

Find this exact block in `src/routes/auth.tsx`:

```tsx
                </button>
              </div>
            </div>
            <TurnstileWidget onToken={setCaptchaToken} />
```

Replace with:

```tsx
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">
                Forgot password?
              </Link>
            </div>
            <TurnstileWidget onToken={setCaptchaToken} />
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no new errors beyond the pre-existing baseline.

- [ ] **Step 4: Start the dev server and confirm the link works**

Run: `bun run dev`, open `/auth`, confirm "Forgot password?" appears below the password field and clicking it navigates to `/forgot-password`. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.tsx
git commit -m "Add forgot-password link to login page"
```

---

### Task 6: Manual prerequisites and live end-to-end verification

**Files:** none (operational/manual — no code changes)

This task has no automatable steps for whoever/whatever is executing this plan without live Supabase Dashboard and email access — each step below says explicitly who must perform it.

- [ ] **Step 1 (user action, Supabase Dashboard):** Apply the Task 1 migration to the live database if not already done (SQL editor or `supabase db push`), then regenerate `types.ts` for real and replace the hand-added block from Task 1 Step 2.

- [ ] **Step 2 (user action, Supabase Dashboard):** Go to Authentication → Email Templates → "Reset Password" and edit the template to include `{{ .Token }}` (the raw 6-digit OTP), since the default template only has a clickable link. Without this, no code will ever arrive by email and the flow cannot work.

- [ ] **Step 3 (user action, optional, Supabase Dashboard):** Under Authentication → Settings, consider lowering "Mailer OTP Expiry" from the 3600s default to 600–900s (10–15 minutes) to shrink the brute-force window further, on top of the Task 2 lockout.

- [ ] **Step 4 (user or agent with live DB/email access):** Request a reset for a throwaway test account at `/forgot-password` → confirm the generic message shows → confirm a 6-digit code arrives by email.

- [ ] **Step 5:** Enter the correct code at `/reset-password` → confirm it advances to the new-password step → set a new password → confirm redirect to `/auth` → confirm login succeeds with the new password.

- [ ] **Step 6:** Enter a wrong code 5 times → confirm the 6th attempt shows the lockout message. Confirm requesting a fresh code does not bypass the lockout within the same 15-minute window (expected trade-off, documented in the spec).

- [ ] **Step 7:** Open the test account in two browsers/sessions. Reset the password from one. Confirm the other session's next authenticated request fails (global session revocation worked).

- [ ] **Step 8:** Confirm requesting a reset for an email with no account still shows the generic "sent if it exists" message (no enumeration).

- [ ] **Step 9:** Delete all throwaway test data (test account, any stray `password_reset_attempts` rows) afterward, per this codebase's existing cleanup discipline.

---

## Self-Review Notes

- **Spec coverage:** Goals 1–3 → Tasks 3, 5 (universal link), Tasks 3–4 (code flow), Task 2 + Global Constraints (lockout/no-tamperable-flag/revocation/generic messaging). Non-goals respected: no admin-initiated reset UI added, no custom email pipeline, no MFA, no email-change flow, no cleanup cron for the new table. Section G's Dashboard prerequisite is Task 6 Steps 1–3. Section J's verification plan is Task 6 Steps 4–9.
- **Placeholder scan:** none — every step has literal file contents or literal commands.
- **Type consistency:** `verifyResetCode` returns `{ access_token, refresh_token }` in Task 2 and is consumed with that exact shape in Task 4. `revokeAllSessions` takes `{ accessToken }` in both. `password_reset_attempts` row shape matches between the Task 1 migration and Task 1's hand-added type block.
