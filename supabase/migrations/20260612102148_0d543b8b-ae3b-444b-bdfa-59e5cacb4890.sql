
CREATE POLICY "Admins read employee photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-photos');

CREATE POLICY "Admins upload employee photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-photos');

CREATE POLICY "Admins update employee photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-photos')
  WITH CHECK (bucket_id = 'employee-photos');

CREATE POLICY "Admins delete employee photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-photos');
