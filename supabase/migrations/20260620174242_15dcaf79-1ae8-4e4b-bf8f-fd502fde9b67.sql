-- HOLIDAYS
CREATE TYPE public.holiday_type AS ENUM ('public', 'company');

CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date date NOT NULL UNIQUE,
  type public.holiday_type NOT NULL DEFAULT 'public',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view holidays"
  ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage holidays"
  ON public.holidays FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'));

-- SHIFTS
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  late_cutoff_minutes int NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view shifts"
  ON public.shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage shifts"
  ON public.shifts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'));

INSERT INTO public.shifts (name, start_time, end_time, late_cutoff_minutes, is_default) VALUES
  ('General', '09:30', '18:30', 0, true),
  ('Morning', '06:00', '14:00', 0, false),
  ('Evening', '14:00', '22:00', 0, false);

-- EMPLOYEE SHIFTS
CREATE TABLE public.employee_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employee_shifts_employee_idx ON public.employee_shifts(employee_id, effective_from DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_shifts TO authenticated;
GRANT ALL ON public.employee_shifts TO service_role;
ALTER TABLE public.employee_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view employee shifts"
  ON public.employee_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage employee shifts"
  ON public.employee_shifts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'));

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER holidays_updated BEFORE UPDATE ON public.holidays FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER shifts_updated BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER employee_shifts_updated BEFORE UPDATE ON public.employee_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();