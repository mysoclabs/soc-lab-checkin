
CREATE TYPE public.leave_type AS ENUM ('casual', 'sick', 'emergency', 'wfh');
CREATE TYPE public.leave_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  leave_type public.leave_type NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  status public.leave_status NOT NULL DEFAULT 'pending',
  admin_comment text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_employee ON public.leave_requests(employee_id);
CREATE INDEX idx_leave_requests_user ON public.leave_requests(user_id);
CREATE INDEX idx_leave_requests_status ON public.leave_requests(status);
CREATE INDEX idx_leave_requests_dates ON public.leave_requests(start_date, end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Admins can do anything
CREATE POLICY "Admins manage all leave requests"
ON public.leave_requests FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'));

-- Employees can view their own requests (matched by user_id OR by email on students)
CREATE POLICY "Employees view their own leave requests"
ON public.leave_requests FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR employee_id IN (
    SELECT id FROM public.students WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
);

-- Employees can create their own requests
CREATE POLICY "Employees create their own leave requests"
ON public.leave_requests FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND employee_id IN (
    SELECT id FROM public.students WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_leave_requests_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leave_requests_updated_at
BEFORE UPDATE ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION public.update_leave_requests_updated_at();
