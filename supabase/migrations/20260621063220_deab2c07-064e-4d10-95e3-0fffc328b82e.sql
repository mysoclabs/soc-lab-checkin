CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email::text FROM auth.users WHERE id = auth.uid()
$$;

DROP POLICY IF EXISTS "Admins manage all students - select" ON public.students;

CREATE POLICY "Admins manage all students - select"
ON public.students
FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin'::app_role)
  OR has_role(auth.uid(), 'hr_admin'::app_role)
  OR email = public.current_user_email()
);