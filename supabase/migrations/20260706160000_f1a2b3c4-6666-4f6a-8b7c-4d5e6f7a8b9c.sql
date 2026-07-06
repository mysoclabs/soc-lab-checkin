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
