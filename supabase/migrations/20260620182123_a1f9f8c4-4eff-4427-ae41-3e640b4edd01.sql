DROP POLICY IF EXISTS "Authenticated insert attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated update attendance" ON public.attendance;
CREATE POLICY "Admins insert attendance" ON public.attendance FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role));
CREATE POLICY "Admins update attendance" ON public.attendance FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role));

DROP POLICY IF EXISTS "Authenticated insert audit logs" ON public.audit_logs;
CREATE POLICY "Users insert own audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;
CREATE POLICY "Insert own or admin notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK ((audience = 'admins' AND user_id IS NULL) OR (audience = 'user' AND user_id = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role));

DROP POLICY IF EXISTS "Finance manage expenses" ON public.expenses;
CREATE POLICY "Finance manage expenses" ON public.expenses FOR ALL TO authenticated USING (public.has_finance_access(auth.uid())) WITH CHECK (public.has_finance_access(auth.uid()));
DROP POLICY IF EXISTS "Finance manage revenues" ON public.revenues;
CREATE POLICY "Finance manage revenues" ON public.revenues FOR ALL TO authenticated USING (public.has_finance_access(auth.uid())) WITH CHECK (public.has_finance_access(auth.uid()));
DROP POLICY IF EXISTS "Finance manage payroll" ON public.payroll;
CREATE POLICY "Finance manage payroll" ON public.payroll FOR ALL TO authenticated USING (public.has_finance_access(auth.uid())) WITH CHECK (public.has_finance_access(auth.uid()));
DROP POLICY IF EXISTS "Finance manage invoices" ON public.invoices;
CREATE POLICY "Finance manage invoices" ON public.invoices FOR ALL TO authenticated USING (public.has_finance_access(auth.uid())) WITH CHECK (public.has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Admins read employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins upload employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins update employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete employee photos" ON storage.objects;
CREATE POLICY "Admins or owner read employee photos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'employee-photos' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role) OR EXISTS (SELECT 1 FROM public.students s WHERE s.email = (SELECT email FROM auth.users WHERE id = auth.uid())::text AND (storage.objects.name LIKE s.id::text || '/%' OR storage.objects.name LIKE s.id::text || '.%' OR storage.objects.name = s.id::text))));
CREATE POLICY "Admins upload employee photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'employee-photos' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role)));
CREATE POLICY "Admins update employee photos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'employee-photos' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role))) WITH CHECK (bucket_id = 'employee-photos' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role)));
CREATE POLICY "Admins delete employee photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'employee-photos' AND (public.has_role(auth.uid(), 'super_admin'::app_role) OR public.has_role(auth.uid(), 'hr_admin'::app_role)));

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_finance_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_finance_access(uuid) TO authenticated;