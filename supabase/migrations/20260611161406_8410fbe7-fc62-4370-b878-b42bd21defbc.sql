
DROP POLICY IF EXISTS "Authenticated admins can insert students" ON public.students;
DROP POLICY IF EXISTS "Authenticated admins can update students" ON public.students;
DROP POLICY IF EXISTS "Authenticated admins can delete students" ON public.students;
DROP POLICY IF EXISTS "Authenticated admins can insert attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated admins can update attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated admins can delete attendance" ON public.attendance;

CREATE POLICY "Admins insert students" ON public.students
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins update students" ON public.students
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins delete students" ON public.students
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins insert attendance" ON public.attendance
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins update attendance" ON public.attendance
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins delete attendance" ON public.attendance
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
