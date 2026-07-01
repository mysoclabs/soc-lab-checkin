-- Fix for Vulnerability Report finding #4 (Medium) — audit log fabrication.
--
-- Even scoped to "insert only your own user_id", letting the browser write
-- audit_logs directly means any authenticated user can still fabricate fake
-- actions/entities/details under their own identity, polluting the trail
-- used for security monitoring and incident response. The report's own
-- remediation is explicit: audit log entries should only ever be created by
-- trusted backend services, never by direct client access.
--
-- This drops every existing policy on the table first (not just the ones we
-- know the name of) so no untracked leftover policy can silently keep
-- allowing client inserts, then recreates only the SELECT policy for admins.
-- No INSERT policy is recreated for anon/authenticated — this is
-- intentional, default-deny. Writes now go exclusively through the
-- createAuditLog server function, which uses the service-role client and
-- therefore bypasses RLS entirely.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.audit_logs', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "audit_logs_select_admin"
ON public.audit_logs FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
);

-- ============ verify ============
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs';
