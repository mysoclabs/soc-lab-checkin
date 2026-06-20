CREATE TABLE IF NOT EXISTS public.office_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  office_start_time TIME NOT NULL DEFAULT '09:30:00',
  office_end_time TIME NOT NULL DEFAULT '18:30:00',
  working_hours NUMERIC(4,2) NOT NULL DEFAULT 8,
  grace_period_minutes INTEGER NOT NULL DEFAULT 15,
  late_threshold TIME NOT NULL DEFAULT '09:45:00',
  half_day_threshold TIME NOT NULL DEFAULT '11:00:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT office_settings_singleton CHECK (id = 1)
);

GRANT SELECT ON public.office_settings TO authenticated;
GRANT INSERT, UPDATE ON public.office_settings TO authenticated;
GRANT ALL ON public.office_settings TO service_role;

ALTER TABLE public.office_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "office_settings_read_all_auth"
  ON public.office_settings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "office_settings_admin_insert"
  ON public.office_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'));

CREATE POLICY "office_settings_admin_update"
  ON public.office_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'));

CREATE TRIGGER office_settings_set_updated_at
  BEFORE UPDATE ON public.office_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.office_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;