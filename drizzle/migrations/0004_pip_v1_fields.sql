-- Employee-visible plan fields: covered by the existing pip_records SELECT policy.
ALTER TABLE public.pip_records
  ADD COLUMN IF NOT EXISTS support_provided text,
  ADD COLUMN IF NOT EXISTS consequences text,
  ADD COLUMN IF NOT EXISTS extension_reason text;
