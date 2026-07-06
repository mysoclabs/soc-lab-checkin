-- Fix for Vulnerability Report findings N2 (Low) and N3 (Low) — shifts and
-- employee_shifts readable by every authenticated employee.
--
-- Root cause (unlike N1, this is deliberate, not drift): 20260620174242
-- created "USING (true)" SELECT policies on both tables so that the
-- scanner check-in flow (src/lib/resolve-shift.ts, called from
-- scanner.tsx) could resolve a *different* employee's shift assignment
-- before recording their check-in. Opening the whole table to every
-- authenticated user was overkill for that need and lets any employee
-- enumerate every other employee's shift roster via a direct REST call
-- (employee_id -> shift_id mapping), even though the UI never surfaces
-- this to non-admins.
--
-- This is safe to tighten to admin-or-self without breaking the scanner
-- flow: attendance INSERT is already admin/hr_admin-only (20260620182123),
-- so only admin/hr_admin accounts can ever complete a check-in that
-- triggers the cross-employee shift lookup, and they're covered by the
-- has_role() clause below regardless of whose record they're resolving.
--
-- shifts keeps is_default = true visible to everyone (every employee's
-- dashboard falls back to the default shift's times), plus the caller's
-- own assigned shift, plus full access for admin/hr_admin.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'employee_shifts'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.employee_shifts', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "employee_shifts_select_admin_or_self"
ON public.employee_shifts FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
  OR employee_id IN (
    SELECT id FROM public.students WHERE email = public.current_user_email()
  )
);

CREATE POLICY "employee_shifts_manage_admin"
ON public.employee_shifts FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role));

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shifts'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.shifts', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "shifts_select_admin_or_relevant"
ON public.shifts FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'hr_admin'::app_role)
  OR is_default = true
  OR id IN (
    SELECT es.shift_id FROM public.employee_shifts es
    JOIN public.students s ON s.id = es.employee_id
    WHERE s.email = public.current_user_email()
  )
);

CREATE POLICY "shifts_manage_admin"
ON public.shifts FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role));

-- ============ verify ============
-- SELECT tablename, policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename IN ('shifts','employee_shifts')
-- ORDER BY tablename, cmd;
