-- PIP v2: per-plan reporting manager, comments, documents.
-- Writes to the new tables go through server functions (service role); browsers only get SELECT.

ALTER TABLE public.pip_records
  ADD COLUMN IF NOT EXISTS manager_user_id uuid,
  ADD COLUMN IF NOT EXISTS manager_email text;
CREATE INDEX IF NOT EXISTS pip_records_manager_idx ON public.pip_records (manager_user_id, status);

-- The assigned manager sees published plans they manage. Goals and check-ins follow the parent plan.
DROP POLICY IF EXISTS "PIP records visible to authorized users" ON public.pip_records;
CREATE POLICY "PIP records visible to authorized users" ON public.pip_records
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (public.has_role(auth.uid(), 'hr_admin'::public.app_role) AND hr_owner_user_id = auth.uid())
    OR (manager_user_id = auth.uid() AND status <> 'draft')
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

-- Managers can read the employee's response; HR internal notes stay HR-only (policy unchanged).
DROP POLICY IF EXISTS "PIP responses visible to authorized users" ON public.pip_employee_responses;
CREATE POLICY "PIP responses visible to authorized users" ON public.pip_employee_responses
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.pip_records p
      WHERE p.id = pip_id
        AND (
          (public.has_role(auth.uid(), 'hr_admin'::public.app_role) AND p.hr_owner_user_id = auth.uid())
          OR (p.manager_user_id = auth.uid() AND p.status <> 'draft')
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

CREATE TABLE IF NOT EXISTS public.pip_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id uuid NOT NULL REFERENCES public.pip_records(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 3000),
  author_user_id uuid NOT NULL,
  author_email text NOT NULL,
  author_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pip_comments TO authenticated;
GRANT ALL ON public.pip_comments TO service_role;
ALTER TABLE public.pip_comments ENABLE ROW LEVEL SECURITY;
-- Everyone who can see the plan sees its comments (employees only see published plans).
CREATE POLICY "PIP comments visible with parent plan" ON public.pip_comments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pip_records p WHERE p.id = pip_id));
CREATE INDEX IF NOT EXISTS pip_comments_plan_idx ON public.pip_comments (pip_id, created_at);

CREATE TABLE IF NOT EXISTS public.pip_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id uuid NOT NULL REFERENCES public.pip_records(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  content_type text,
  size_bytes integer NOT NULL DEFAULT 0,
  shared_with_employee boolean NOT NULL DEFAULT false,
  uploaded_by uuid NOT NULL,
  uploaded_by_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pip_documents TO authenticated;
GRANT ALL ON public.pip_documents TO service_role;
ALTER TABLE public.pip_documents ENABLE ROW LEVEL SECURITY;
-- Super Admin and the HR owner see every document; manager and employee only shared ones.
CREATE POLICY "PIP documents visible to authorized users" ON public.pip_documents
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.pip_records p
      WHERE p.id = pip_id
        AND (
          (public.has_role(auth.uid(), 'hr_admin'::public.app_role) AND p.hr_owner_user_id = auth.uid())
          OR shared_with_employee
        )
    )
  );
CREATE INDEX IF NOT EXISTS pip_documents_plan_idx ON public.pip_documents (pip_id, created_at DESC);

-- Private bucket with no storage policies: only the server (service role) reads or writes it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pip-documents', 'pip-documents', false, 10485760,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;
