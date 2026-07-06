-- Fix for drift finding: office_settings — a table that exists live but was
-- never captured by ANY migration. It was created directly via the Studio
-- Table Editor (confirmed by its GRANTs: ALL privileges including TRUNCATE/
-- REFERENCES/TRIGGER to anon, authenticated AND service_role — Studio's
-- default when you tick "Enable RLS" on a new table, unlike every other
-- table in this schema, which grants only the verbs actually needed and
-- never grants anon anything).
--
-- Its RLS policies looked admin-gated by name but were not by substance:
--   "Admins can insert office settings"  ->  WITH CHECK (true)
--   "Admins can update office settings"  ->  USING (true)
--   "Authenticated users can view..."    ->  USING (true)
-- i.e. any authenticated employee could read AND silently rewrite the
-- company's office hours / late threshold / grace period / working hours
-- (this is worse than a read-only leak — it's a tamper/integrity issue).
--
-- The table is unused by the app (only appears in the generated
-- src/integrations/supabase/types.ts, never queried anywhere in src/),
-- and looks superseded by the shifts/employee_shifts system, but it still
-- holds one live config row, so we keep the data and lock it down rather
-- than dropping it blind.
--
-- This backfills the schema into git (CREATE TABLE IF NOT EXISTS, matching
-- the live column set/defaults exactly), tightens GRANTs to the same
-- pattern every other table in this schema uses (no anon, no
-- TRUNCATE/REFERENCES/TRIGGER), and replaces the true/true/true policies
-- with a real admin/hr_admin-only gate.

CREATE TABLE IF NOT EXISTS public.office_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  office_start_time TIME NOT NULL DEFAULT '09:30:00',
  office_end_time TIME NOT NULL DEFAULT '18:30:00',
  late_threshold TIME NOT NULL DEFAULT '09:45:00',
  half_day_threshold TIME NOT NULL DEFAULT '11:00:00',
  grace_period_minutes INTEGER NOT NULL DEFAULT 15,
  working_hours INTEGER NOT NULL DEFAULT 8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.office_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.office_settings FROM PUBLIC, anon;
REVOKE ALL ON public.office_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_settings TO authenticated;
GRANT ALL ON public.office_settings TO service_role;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'office_settings'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.office_settings', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "office_settings_manage_admin"
ON public.office_settings FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role));

CREATE TRIGGER office_settings_set_updated_at BEFORE UPDATE ON public.office_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ verify ============
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE schemaname='public' AND tablename='office_settings';
--
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema='public' AND table_name='office_settings' ORDER BY grantee, privilege_type;
