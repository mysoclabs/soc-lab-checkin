# Forgot Password / Reset Password

## Problem

No account on this app — employee or admin — has any way to recover access if
they forget their password. The login page (`src/routes/auth.tsx`) is a bare
email/password form with no "forgot password" link, and nothing in
`src/lib/users.functions.ts` or elsewhere lets a user reset their own
password. Combined with the sync-check spec's finding that
`provisionEmployeeUser` discards its generated password, an employee whose
account gets recreated (or who simply forgets their password) has no
self-service way back in — someone has to manually intervene every time.

This is a greenfield feature: no forgot/reset UI, no email-sending code, and
no admin password-reset function exist anywhere in the repo today (confirmed
by grepping for `resetPasswordForEmail`, `forgot`, `reset-password`,
`recovery`, `updateUserById` — zero matches).

## Goals

1. A "Forgot password?" link on the login page, usable by any account type
   (employee, hr_admin, super_admin, founder, finance) since they all share
   the same login page and `auth.users` table.
2. A code-based reset flow: request → a 6-digit code is emailed → the user
   enters the code to verify → sets a new password → is sent back to the
   login page to sign in with it. Not a clickable magic-link flow.
3. Defense-in-depth security so that neither guessing the code nor holding a
   previously-leaked session token lets an attacker take over an account:
   - Reuse the existing Turnstile CAPTCHA (already used on login) on both the
     request step and any resend.
   - Server-side attempt lockout on code verification, mirroring the
     `login_attempts` / `loginWithLockout` pattern already in this codebase
     (itself a fix for Vulnerability Report finding #1).
   - No client-side "verified" flag to tamper with — the only proof of
     verification is a genuine Supabase session obtained via `verifyOtp`,
     validated server-side by Supabase Auth against a hashed, single-use,
     expiring code.
   - On a successful reset, revoke every existing session for that account,
     so a previously-leaked JWT/refresh token stops working immediately.
   - Generic responses on both the request and verify steps, so neither step
     reveals whether an email has an account or (beyond "invalid/expired")
     why a code failed.

## Non-goals

- Admin-initiated password reset (an admin resetting it *for* an employee) —
  a real, separately useful feature, but out of scope here; this spec is
  self-service only. Can be designed later as its own small addition to the
  Users & Roles page.
- Custom-branded reset emails / a bespoke email-sending pipeline. This reuses
  Supabase's already-working auth email delivery and its built-in recovery
  template (modified to surface the OTP code — see Design section G).
- Multi-factor authentication.
- Changing/verifying a user's email address.
- A cleanup job for the new attempts table — `login_attempts` already has no
  automated pruning either (just a commented-out manual `DELETE`), so this
  follows the same accepted, pre-existing pattern rather than introducing a
  cron job scoped to just this feature.
- Tuning the lockout thresholds differently from login's. See Design section
  B for the math on why reusing the same constants (5 failures / 15 minute
  window / 15 minute lockout) is already sufficient for a 6-digit code.

## Design

### A) Database — `password_reset_attempts` table

New migration, structurally identical to `login_attempts`
(`supabase/migrations/20260701115117_a3d8e5c1-7f42-4b9e-8c1a-6d9f3e2b8a4d.sql`):

```sql
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

A separate table (not reusing `login_attempts`) because it tracks a
different event — OTP verification, not password sign-in — and keeping them
separate avoids the two failure-counters interfering with each other for the
same account.

### B) Backend — `verifyResetCode` server function

New function in `src/lib/password-reset.functions.ts`, following the exact
shape of `loginWithLockout` in `src/lib/login.functions.ts`:

1. Zod-validate `{ email, code }` (`code`: 6-digit numeric string).
2. Using `supabaseAdmin` (service role), count failed
   `password_reset_attempts` rows for `lower(email)` in the trailing 15
   minutes. If ≥ 5, throw a generic `"Too many attempts. Request a new code
   and try again in <n> minutes."` — same `FAILURE_THRESHOLD` / `WINDOW_MINUTES`
   / `LOCKOUT_MINUTES` constants as login (5 / 15 / 15).
3. Otherwise, create a fresh anon client (`persistSession: false`, same
   pattern as `loginWithLockout`) and call
   `anon.auth.verifyOtp({ email, token: code, type: "recovery" })`.
4. Insert the attempt (`email`, `ip_address` via the same `getClientIp()`
   helper, `success`) into `password_reset_attempts`.
5. On failure: throw `"Invalid or expired code."` (doesn't distinguish wrong
   code / wrong email / expired).
6. On success: return `{ access_token, refresh_token }` from
   `verifyOtp`'s returned session, same shape `auth.tsx` already expects from
   `loginWithLockout`.

**Why 5/15/15 is enough for a 6-digit code:** a 6-digit OTP has 1,000,000
possible values. At 5 guesses per 15-minute window per email, exhausting the
space would take roughly 200,000 windows ≈ 4+ years — combined with the
code's own short expiry (see section G) and single-use enforcement by
Supabase, brute-forcing the code is not practical. This is the same
reasoning that justifies reusing (not re-tuning) the login constants.

**Inherited trade-off:** because the lockout keys on `email` + time window
(not on a specific issued code), an attacker who deliberately burns 5 failed
attempts locks out the real user for the rest of that 15-minute window even
if the user then requests a fresh code. This is the same trade-off
`login_attempts` already accepts for sign-in lockout — not a new regression
introduced by this feature.

### C) Backend — `revokeAllSessions` server function

New function in the same file. Input: `{ accessToken: string }` (zod
string). Calls `supabaseAdmin.auth.admin.signOut(accessToken, "global")`,
which invalidates every refresh token/session for the user that token
belongs to. No additional authorization check is needed beyond the token
itself being valid: whoever holds a valid access token for an account can
already act as that account, so letting that same token trigger a global
sign-out doesn't grant any new capability — it only lets the legitimate
reset flow close out standing sessions (including any previously-leaked
token) the moment the password changes.

### D) Frontend — `/forgot-password` route

New public route (sibling of `/auth`, no `RoleGuard`), same visual shell as
the login page. Fields: email input, `TurnstileWidget`. On submit:

1. Zod-validate the email.
2. Call `supabase.auth.resetPasswordForEmail(email, { captchaToken })`
   directly from the browser client (no server function needed — this is an
   anon-key operation, same trust level as `signInWithPassword`).
3. Regardless of the call's outcome, show the same message: "If that email
   has an account, we've sent a reset code." (Supabase itself doesn't leak
   account existence from this call; the UI must not contradict that by
   branching on success/failure.)
4. Navigate to `/reset-password`, passing the entered email via router
   search params.

### E) Frontend — `/reset-password` route

New public route, two steps on one page. Reads `email` from the search
params; if missing (e.g. direct navigation), shows an inline email field
before Step 1 instead of a hard redirect.

**Step 1 — enter code:** 6-digit code input + "Verify code" button + a
"Didn't get a code? Resend" link (re-triggers the same
`resetPasswordForEmail` call plus a fresh `TurnstileWidget` challenge;
Supabase's own per-email send cooldown backs this up against resend spam).
On submit, calls `verifyResetCode`; on success, calls
`supabase.auth.setSession({ access_token, refresh_token })` and advances to
Step 2. On failure, shows the thrown message via toast and stays on Step 1.

**Step 2 — set new password:** new-password + confirm-password fields,
reusing the existing `min(6).max(72)` rule from `auth.tsx`'s schema plus a
match check between the two fields. Guards on mount: if reached without an
active session (e.g. manual navigation), bounces back to Step 1. On submit:

1. `supabase.auth.updateUser({ password })`.
2. On success, call `revokeAllSessions({ accessToken: session.access_token })`.
3. `supabase.auth.signOut()` (clears local session/storage; the account is
   *not* auto-logged-in after a reset).
4. Toast "Password updated — please log in." and
   `navigate({ to: "/auth", replace: true })`.

### F) Login page — `src/routes/auth.tsx`

Add a "Forgot password?" link/button below the password field, navigating to
`/forgot-password`. No changes to the existing sign-in logic.

### G) Supabase Dashboard prerequisite (manual, not code)

The default recovery email template only contains `{{ .ConfirmationURL }}`
(a clickable link). For a code-based flow, the template must be edited
(Dashboard → Authentication → Email Templates → "Reset Password") to include
`{{ .Token }}`, the raw 6-digit OTP. This can't be applied from this repo
(`supabase/config.toml` has no `[auth]` block — auth/email settings for this
project live entirely in the Dashboard). Flagging this explicitly since the
feature will silently not work (code never arrives) until this template
change is made.

Also recommended (optional, Dashboard → Authentication → Settings): lower
the "Mailer OTP Expiry" from its default (3600s / 1 hour) down to something
like 600–900s (10–15 minutes), shrinking the brute-force window further on
top of the attempt lockout in section B.

### H) Error handling

Both new server functions and both new pages follow the same
thrown-`Error` → toast pattern used everywhere else in this codebase (e.g.
`auth.tsx`'s existing `catch` block) — no new error-handling pattern
introduced.

### I) Security summary

- CAPTCHA (Turnstile) on both the initial request and any resend.
- Generic, non-distinguishing responses on both the request step (always
  "sent if it exists") and the verify step ("invalid or expired code" /
  "too many attempts") — no account-existence or failure-reason oracle.
- Server-side attempt lockout on code verification, mirroring the
  already-shipped, pentest-driven `login_attempts` pattern.
- The only trust anchor for "has this user proven code ownership" is a real
  Supabase session token issued by `verifyOtp` — nothing client-side can
  forge or flip that state.
- All existing sessions for the account are revoked the moment the password
  is successfully changed, so a token leaked before the reset (stolen
  refresh token, forgotten logged-in device, prior XSS) stops working
  immediately afterward.
- Recovery code is single-use (enforced by Supabase) and short-lived (see
  section G).
- Transport: tokens move from server function to browser over HTTPS in a
  response body — identical trust model to the existing `loginWithLockout`
  flow, not a new exposure.

### J) Testing / verification plan

No automated test setup exists for this app's server functions (all
verification so far has been manual/live, per the sync-check spec). Plan:

1. Request a reset for a throwaway test account → confirm the generic
   message shows regardless → confirm a 6-digit code arrives by email.
2. Enter the correct code → confirm it advances to Step 2 → set a new
   password → confirm redirect to `/auth` → confirm login succeeds with the
   new password.
3. Enter a wrong code 5 times → confirm the 6th attempt returns the lockout
   message. Confirm requesting a fresh code does not bypass the lockout
   within the same 15-minute window (expected/accepted trade-off, see
   section B).
4. Open two sessions for the same test account (e.g. two browsers). Reset
   the password from one. Confirm the other session's next authenticated
   request fails (session revoked).
5. Confirm an account with no matching email still gets the generic
   "sent if it exists" message on request (no enumeration).
6. Delete all throwaway test data afterward, per this codebase's existing
   cleanup discipline.

## Open questions

None outstanding — thresholds, messaging, and session-revocation behavior
were all decided above rather than left open.
