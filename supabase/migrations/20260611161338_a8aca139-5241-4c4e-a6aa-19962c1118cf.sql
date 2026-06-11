
-- Sequence for unique student IDs
CREATE SEQUENCE IF NOT EXISTS public.student_id_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_student_id()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_val INTEGER;
BEGIN
  next_val := nextval('public.student_id_seq');
  RETURN 'MSL-' || to_char(now(), 'YYYY') || '-' || lpad(next_val::text, 4, '0');
END;
$$;

CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL UNIQUE DEFAULT public.generate_student_id(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  batch TEXT,
  qr_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated admins can view students"
  ON public.students FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated admins can insert students"
  ON public.students FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated admins can update students"
  ON public.students FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated admins can delete students"
  ON public.students FOR DELETE TO authenticated USING (true);

CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, date)
);

CREATE INDEX idx_attendance_date ON public.attendance(date);
CREATE INDEX idx_attendance_student ON public.attendance(student_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated admins can view attendance"
  ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated admins can insert attendance"
  ON public.attendance FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated admins can update attendance"
  ON public.attendance FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated admins can delete attendance"
  ON public.attendance FOR DELETE TO authenticated USING (true);
