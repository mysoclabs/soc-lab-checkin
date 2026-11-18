CREATE TABLE IF NOT EXISTS public.assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  department text,
  instructions text,
  duration_minutes integer NOT NULL DEFAULT 30,
  passing_percentage numeric NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'draft',
  settings jsonb NOT NULL DEFAULT '{"randomize_questions":false,"randomize_options":false,"allow_previous":true,"auto_submit":true,"show_results":true}'::jsonb,
  available_from timestamptz,
  due_at timestamptz,
  created_by uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessments TO authenticated;
GRANT ALL ON public.assessments TO service_role;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins manage assessments" ON public.assessments;
CREATE POLICY "Super admins manage assessments" ON public.assessments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(),'super_admin'::public.app_role));
DROP TRIGGER IF EXISTS assessments_updated ON public.assessments;
CREATE TRIGGER assessments_updated BEFORE UPDATE ON public.assessments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.assessment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  type text NOT NULL DEFAULT 'mcq',
  prompt text NOT NULL DEFAULT '',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct jsonb NOT NULL DEFAULT '[]'::jsonb,
  marks numeric NOT NULL DEFAULT 1,
  required boolean NOT NULL DEFAULT true,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_questions_pos_idx ON public.assessment_questions(assessment_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_questions TO authenticated;
GRANT ALL ON public.assessment_questions TO service_role;
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins manage questions" ON public.assessment_questions;
CREATE POLICY "Super admins manage questions" ON public.assessment_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(),'super_admin'::public.app_role));
DROP TRIGGER IF EXISTS assessment_questions_updated ON public.assessment_questions;
CREATE TRIGGER assessment_questions_updated BEFORE UPDATE ON public.assessment_questions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.assessment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, student_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_assignments TO authenticated;
GRANT ALL ON public.assessment_assignments TO service_role;
ALTER TABLE public.assessment_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins manage assignments" ON public.assessment_assignments;
CREATE POLICY "Super admins manage assignments" ON public.assessment_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(),'super_admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.assessment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  question_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  option_order jsonb NOT NULL DEFAULT '{}'::jsonb,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  marked jsonb NOT NULL DEFAULT '[]'::jsonb,
  question_times jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_index integer NOT NULL DEFAULT 0,
  manual_marks jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric,
  max_score numeric,
  percentage numeric,
  correct_count integer,
  wrong_count integer,
  skipped_count integer,
  pending_review_count integer,
  time_taken_seconds integer,
  passed boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_attempts TO authenticated;
GRANT ALL ON public.assessment_attempts TO service_role;
ALTER TABLE public.assessment_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins manage attempts" ON public.assessment_attempts;
CREATE POLICY "Super admins manage attempts" ON public.assessment_attempts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(),'super_admin'::public.app_role));
DROP TRIGGER IF EXISTS assessment_attempts_updated ON public.assessment_attempts;
CREATE TRIGGER assessment_attempts_updated BEFORE UPDATE ON public.assessment_attempts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.assessment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.assessment_attempts(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  type text NOT NULL,
  question_index integer,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_events_attempt_idx ON public.assessment_events(attempt_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_events TO authenticated;
GRANT ALL ON public.assessment_events TO service_role;
ALTER TABLE public.assessment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins read events" ON public.assessment_events;
CREATE POLICY "Super admins read events" ON public.assessment_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(),'super_admin'::public.app_role));