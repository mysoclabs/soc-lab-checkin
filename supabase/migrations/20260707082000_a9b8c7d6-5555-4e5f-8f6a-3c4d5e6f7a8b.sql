-- Fix: employees cannot check in/out via the QR scanner ("new row violates
-- row-level security policy for table \"attendance\"").
--
-- Root cause: the scanner (src/routes/_authenticated/scanner.tsx) is a
-- self-service flow -- each employee opens it under their own account and
-- scans their own QR code to write their own attendance row directly via
-- the Supabase client (confirmed by
-- docs/superpowers/specs/2026-07-01-attendance-scan-cooldown-shift-windows-design.md,
-- which describes admin check-out as a *separate* override on the
-- /attendance page). But the INSERT/UPDATE policies on `attendance`
-- (20260620182123, reaffirmed by 20260706120000) only grant
-- super_admin/hr_admin, so every check-in/out attempt by a plain
-- "employee" or "founder" role is rejected by RLS before it reaches the
-- table.
--
-- This adds a self-service allowance -- INSERT/UPDATE succeed for admins
-- (any row) or for the caller acting on their own attendance row
-- (student_id resolved via public.current_user_email(), the same
-- SECURITY DEFINER helper already used for the sibling self-select
-- policy) -- without reopening the original vulnerability that let any
-- authenticated user write an arbitrary employee's attendance.

DROP POLICY IF EXISTS "attendance_insert_admin" ON public.attendance;
DROP POLICY IF EXISTS "attendance_update_admin" ON public.attendance;

CREATE POLICY "attendance_insert_admin_or_self"
ON public.attendance FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
  OR student_id IN (
    SELECT id FROM public.students WHERE email = public.current_user_email()
  )
);

CREATE POLICY "attendance_update_admin_or_self"
ON public.attendance FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
  OR student_id IN (
    SELECT id FROM public.students WHERE email = public.current_user_email()
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
  OR student_id IN (
    SELECT id FROM public.students WHERE email = public.current_user_email()
  )
);

-- ============ verify ============
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename='attendance'
-- ORDER BY cmd;
