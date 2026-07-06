-- Fix for storage.objects employee-photos SELECT policy: every non-admin
-- employee gets a hard "permission denied for table users" error trying to
-- view their own photo (reproduced live: POST
-- /storage/v1/object/list/employee-photos with an employee JWT -> 400
-- {"message":"permission denied for table users"}).
--
-- Root cause: same class of bug already fixed on students/attendance
-- (20260621063220, 20260706120000) -- the self-match clause queries
-- auth.users directly (`SELECT email FROM auth.users WHERE id = auth.uid()`),
-- but `authenticated` has no grant to read auth.users. For super_admin/
-- hr_admin, has_role() is true and Postgres short-circuits before reaching
-- that subquery, so admins never hit it -- only regular employees do, since
-- both has_role() checks fail for them and the EXISTS clause must actually
-- run.
--
-- This repoints the self-match at public.current_user_email(), the
-- SECURITY DEFINER helper already used for the equivalent fix elsewhere.
-- INSERT/UPDATE/DELETE policies on this bucket are admin-only and never
-- touch auth.users, so they're untouched.

DROP POLICY IF EXISTS "Admins or owner read employee photos" ON storage.objects;

CREATE POLICY "Admins or owner read employee photos" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'employee-photos' AND (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'hr_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.email = public.current_user_email()
      AND (
        storage.objects.name LIKE s.id::text || '/%'
        OR storage.objects.name LIKE s.id::text || '.%'
        OR storage.objects.name = s.id::text
      )
    )
  )
);

-- ============ verify ============
-- SELECT policyname, cmd, roles, qual FROM pg_policies
-- WHERE schemaname='storage' AND tablename='objects' AND cmd='SELECT';
