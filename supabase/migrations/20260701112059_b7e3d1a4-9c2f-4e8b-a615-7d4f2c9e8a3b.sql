-- Fix for Vulnerability Report findings #2 (Critical) and #3 (High)
--
-- Root cause: at least one untracked/leftover permissive SELECT policy exists on
-- `students` and `leave_requests` that was never captured in the migration history,
-- so it silently overrides the properly-scoped policies (Postgres OR's all permissive
-- policies for the same command together). This script does not guess policy names —
-- it dynamically drops EVERY existing policy on both tables, then recreates only the
-- intended ones, so no stray policy can survive.

-- ============ students ============
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'students'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.students', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "students_select_admin_or_self"
ON public.students FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
  OR email = public.current_user_email()
);

CREATE POLICY "students_insert_admin"
ON public.students FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
);

CREATE POLICY "students_update_admin"
ON public.students FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
);

CREATE POLICY "students_delete_super_admin"
ON public.students FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- ============ leave_requests ============
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leave_requests'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.leave_requests', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "leave_requests_admin_all"
ON public.leave_requests FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
);

CREATE POLICY "leave_requests_select_own"
ON public.leave_requests FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR employee_id IN (
    SELECT id FROM public.students WHERE email = public.current_user_email()
  )
);

CREATE POLICY "leave_requests_insert_own"
ON public.leave_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND employee_id IN (
    SELECT id FROM public.students WHERE email = public.current_user_email()
  )
);

-- ============ verify ============
-- Run this after the above to confirm the final policy set on both tables:
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename IN ('students','leave_requests')
-- ORDER BY tablename, cmd;
