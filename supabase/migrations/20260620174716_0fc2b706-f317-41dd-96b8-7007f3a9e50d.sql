-- AUDIT LOGS
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_name text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON public.audit_logs(created_at DESC);

GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin'));
CREATE POLICY "Authenticated insert audit logs"
  ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- NOTIFICATIONS
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  audience text NOT NULL DEFAULT 'user', -- 'user' or 'admins'
  type text NOT NULL,
  title text NOT NULL,
  message text,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON public.notifications(user_id, created_at DESC);
CREATE INDEX notifications_audience_idx ON public.notifications(audience, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own or admin-broadcast notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (audience = 'admins' AND (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin')))
  );
CREATE POLICY "Authenticated can insert notifications"
  ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Mark own or admin notifications read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (audience = 'admins' AND (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin')))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (audience = 'admins' AND (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'hr_admin')))
  );