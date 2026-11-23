CREATE TABLE public.pip_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  employee_name text NOT NULL,
  employee_email text NOT NULL,
  department text,
  designation text,
  hr_owner_user_id uuid NOT NULL,
  hr_owner_email text NOT NULL,
  created_by uuid NOT NULL,
  start_date date NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  end_date date NOT NULL,
  review_frequency_days integer NOT NULL DEFAULT 14 CHECK (review_frequency_days > 0),
  focus_areas text[] NOT NULL DEFAULT '{}'::text[],
  performance_concerns text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','extended','completed','unsuccessful','cancelled')),
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  published_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
GRANT SELECT ON public.pip_records TO authenticated;
GRANT ALL ON public.pip_records TO service_role;
ALTER TABLE public.pip_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PIP records visible to authorized users" ON public.pip_records
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (public.has_role(auth.uid(), 'hr_admin'::public.app_role) AND hr_owner_user_id = auth.uid())
    OR (
      public.has_role(auth.uid(), 'employee'::public.app_role)
      AND status <> 'draft'
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = employee_id
          AND lower(s.email) = lower(public.current_user_email())
      )
    )
  );
CREATE INDEX pip_records_owner_status_idx ON public.pip_records (hr_owner_user_id, status);
CREATE INDEX pip_records_employee_status_idx ON public.pip_records (employee_id, status);
CREATE TRIGGER pip_records_set_updated_at BEFORE UPDATE ON public.pip_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.pip_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id uuid NOT NULL REFERENCES public.pip_records(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  kpi text NOT NULL,
  target text NOT NULL,
  weight numeric NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 100),
  due_date date,
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','complete')),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  shared_feedback text,
  supporting_evidence text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pip_goals TO authenticated;
GRANT ALL ON public.pip_goals TO service_role;
ALTER TABLE public.pip_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PIP goals visible with parent plan" ON public.pip_goals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pip_records p WHERE p.id = pip_id));
CREATE INDEX pip_goals_plan_position_idx ON public.pip_goals (pip_id, position);
CREATE TRIGGER pip_goals_set_updated_at BEFORE UPDATE ON public.pip_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.pip_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id uuid NOT NULL REFERENCES public.pip_records(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  completed_at timestamptz,
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  shared_summary text,
  hr_feedback text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pip_checkins TO authenticated;
GRANT ALL ON public.pip_checkins TO service_role;
ALTER TABLE public.pip_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PIP check-ins visible with parent plan" ON public.pip_checkins
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pip_records p WHERE p.id = pip_id));
CREATE INDEX pip_checkins_plan_date_idx ON public.pip_checkins (pip_id, scheduled_date);
CREATE TRIGGER pip_checkins_set_updated_at BEFORE UPDATE ON public.pip_checkins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.pip_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id uuid NOT NULL REFERENCES public.pip_records(id) ON DELETE CASCADE,
  checkin_id uuid REFERENCES public.pip_checkins(id) ON DELETE SET NULL,
  note text NOT NULL,
  created_by uuid NOT NULL,
  author_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pip_internal_notes TO authenticated;
GRANT ALL ON public.pip_internal_notes TO service_role;
ALTER TABLE public.pip_internal_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PIP internal notes are HR-only" ON public.pip_internal_notes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'hr_admin'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.pip_records p
        WHERE p.id = pip_id AND p.hr_owner_user_id = auth.uid()
      )
    )
  );
CREATE INDEX pip_internal_notes_plan_idx ON public.pip_internal_notes (pip_id, created_at DESC);

CREATE TABLE public.pip_employee_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id uuid NOT NULL UNIQUE REFERENCES public.pip_records(id) ON DELETE CASCADE,
  response text,
  acknowledged_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.pip_employee_responses TO authenticated;
GRANT ALL ON public.pip_employee_responses TO service_role;
ALTER TABLE public.pip_employee_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PIP responses visible to authorized users" ON public.pip_employee_responses
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'hr_admin'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.pip_records p
        WHERE p.id = pip_id AND p.hr_owner_user_id = auth.uid()
      )
    )
    OR (
      public.has_role(auth.uid(), 'employee'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.pip_records p
        JOIN public.students s ON s.id = p.employee_id
        WHERE p.id = pip_id
          AND p.status <> 'draft'
          AND lower(s.email) = lower(public.current_user_email())
      )
    )
  );
CREATE POLICY "Employees can submit their own PIP response" ON public.pip_employee_responses
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_role(auth.uid(), 'employee'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.pip_records p
      JOIN public.students s ON s.id = p.employee_id
      WHERE p.id = pip_id
        AND p.status <> 'draft'
        AND lower(s.email) = lower(public.current_user_email())
    )
  );
CREATE POLICY "Employees can update their own PIP response" ON public.pip_employee_responses
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'employee'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.pip_records p
      JOIN public.students s ON s.id = p.employee_id
      WHERE p.id = pip_id
        AND p.status <> 'draft'
        AND lower(s.email) = lower(public.current_user_email())
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_role(auth.uid(), 'employee'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.pip_records p
      JOIN public.students s ON s.id = p.employee_id
      WHERE p.id = pip_id
        AND p.status <> 'draft'
        AND lower(s.email) = lower(public.current_user_email())
    )
  );
CREATE INDEX pip_employee_responses_plan_idx ON public.pip_employee_responses (pip_id);
CREATE TRIGGER pip_employee_responses_set_updated_at BEFORE UPDATE ON public.pip_employee_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();