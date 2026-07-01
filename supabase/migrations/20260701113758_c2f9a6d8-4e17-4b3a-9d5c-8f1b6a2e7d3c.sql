-- Fix for Vulnerability Report finding #5 (High) — arbitrary admin
-- notification / phishing link injection.
--
-- The prior INSERT policy's "audience = 'admins' AND user_id IS NULL"
-- clause had no role check at all, so any authenticated employee could
-- create an admin-targeted notification with an arbitrary type/title/
-- message/link (including an external phishing URL). This drops every
-- existing policy on the table first (not just the ones we know the name
-- of) so no untracked leftover policy can silently keep allowing client
-- inserts, then recreates only the SELECT/UPDATE policies. No INSERT
-- policy is recreated for anon/authenticated — this is intentional,
-- default-deny. Writes now go exclusively through the createNotification
-- server function, which validates `type` against a fixed allowlist and
-- `link` as an internal relative path only, then writes via the
-- service-role client, bypassing RLS entirely.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.notifications', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "View own or admin-broadcast notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (audience = 'admins' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role)))
  );

CREATE POLICY "Mark own or admin notifications read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (audience = 'admins' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role)))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (audience = 'admins' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role)))
  );

-- ============ verify ============
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename='notifications';
