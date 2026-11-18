GRANT ALL ON public.login_attempts TO service_role;
GRANT ALL ON public.password_reset_attempts TO service_role;
CREATE INDEX IF NOT EXISTS assessment_assignments_student_idx ON public.assessment_assignments(student_id);
CREATE INDEX IF NOT EXISTS assessment_events_assessment_idx ON public.assessment_events(assessment_id);