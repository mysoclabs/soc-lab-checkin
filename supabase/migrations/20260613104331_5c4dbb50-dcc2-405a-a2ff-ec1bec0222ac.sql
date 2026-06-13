
-- 1. Role enum
CREATE TYPE public.app_role AS ENUM ('super_admin', 'hr_admin', 'employee');

-- 2. user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. has_role security definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4. Policies for user_roles
CREATE POLICY "Users can view their own role"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Super admins view all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- 5. Replace existing students/attendance policies with role-aware ones
DROP POLICY IF EXISTS "Admins delete students" ON public.students;
DROP POLICY IF EXISTS "Admins insert students" ON public.students;
DROP POLICY IF EXISTS "Admins update students" ON public.students;
DROP POLICY IF EXISTS "Authenticated admins can view students" ON public.students;

CREATE POLICY "Admins manage all students - select"
  ON public.students FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'hr_admin')
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "Admins insert students"
  ON public.students FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'hr_admin')
  );

CREATE POLICY "Admins update students"
  ON public.students FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'hr_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'hr_admin')
  );

CREATE POLICY "Super admin delete students"
  ON public.students FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins delete attendance" ON public.attendance;
DROP POLICY IF EXISTS "Admins insert attendance" ON public.attendance;
DROP POLICY IF EXISTS "Admins update attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated admins can view attendance" ON public.attendance;

CREATE POLICY "View attendance by role"
  ON public.attendance FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'hr_admin')
    OR student_id IN (
      SELECT id FROM public.students
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Authenticated insert attendance"
  ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated update attendance"
  ON public.attendance FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins delete attendance"
  ON public.attendance FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'hr_admin')
  );

-- 6. Auto-bootstrap first user as super_admin
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'employee')
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Backfill: if there are existing users but no roles, promote earliest user
DO $$
DECLARE first_user uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    SELECT id INTO first_user FROM auth.users ORDER BY created_at ASC LIMIT 1;
    IF first_user IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (first_user, 'super_admin');
      INSERT INTO public.user_roles (user_id, role)
        SELECT id, 'employee' FROM auth.users WHERE id <> first_user
        ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;
