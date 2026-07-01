-- Fix for Vulnerability Report finding #1 (Medium) — Layer 2: app-side account lockout.
--
-- This table is written to exclusively by the server (service-role client) via the
-- `login.functions.ts` server function — never by the browser directly. RLS is
-- enabled with zero policies for anon/authenticated, so even if someone got a hold of
-- the publishable key + a JWT, they cannot read or write this table over the REST API.
-- The service role always bypasses RLS, which is exactly what the server function uses.

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address text,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON public.login_attempts (lower(email), created_at DESC);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: default-deny for anon/authenticated. Only service_role
-- (which bypasses RLS) may read/write, via the login server function.

-- Optional: prevents this table from growing forever. Safe to run manually every so
-- often, or wire up as a pg_cron job later if you want it automatic.
-- DELETE FROM public.login_attempts WHERE created_at < now() - interval '30 days';
