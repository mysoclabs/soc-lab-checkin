-- Fix for Vulnerability Report finding N1 (Medium) — attendance readable by
-- every employee.
--
-- Root cause: this is the SAME class of bug already fixed for
-- students/leave_requests in 20260701112059 — an untracked/leftover
-- permissive SELECT policy existed on `attendance` in the live database
-- (never captured in migration history), which OR's together with the
-- intended "View attendance by role" policy from 20260613104331. Postgres
-- combines ALL permissive policies for the same command with OR, so the
-- stray policy silently overrides the scoped one and lets any authenticated
-- employee read every student's check-in/out records. That earlier fix
-- covered students/leave_requests only; it never touched attendance.
--
-- This drops every existing policy on the table dynamically (not just ones
-- we know the name of) so no untracked policy can survive, then recreates
-- only the intended set. It also repoints the self-match clause at
-- public.current_user_email() (the SECURITY DEFINER helper introduced in
-- 20260621063220) instead of querying auth.users directly — the
-- `authenticated` role has no grant to read auth.users, which is exactly
-- why that helper exists and why students' equivalent policy already uses
-- it.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.attendance', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "attendance_select_admin_or_self"
ON public.attendance FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
  OR student_id IN (
    SELECT id FROM public.students WHERE email = public.current_user_email()
  )
);

CREATE POLICY "attendance_insert_admin"
ON public.attendance FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
);

CREATE POLICY "attendance_update_admin"
ON public.attendance FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
);

CREATE POLICY "attendance_delete_admin"
ON public.attendance FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
);

-- ============ verify ============
-- Run this BEFORE applying, to see exactly what stray policy was live:
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename='attendance';
--
-- Run this AFTER applying, to confirm only the four policies above exist:
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename='attendance'
-- ORDER BY cmd;
