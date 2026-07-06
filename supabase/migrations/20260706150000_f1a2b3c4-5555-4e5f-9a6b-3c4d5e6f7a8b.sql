-- Create the employee-photos storage bucket.
--
-- src/routes/_authenticated/{me,students.$id,students.index}.tsx have
-- called `supabase.storage.from("employee-photos")` all along, and RLS
-- policies for it have existed since 20260612102148 / tightened in
-- 20260620182123 and 20260706140000 -- but the bucket itself was never
-- created (storage.buckets had zero rows), so photo upload/view has been
-- completely non-functional in production this whole time.
--
-- Private (public = false) to match the app's use of createSignedUrl
-- rather than getPublicUrl -- access is gated entirely by the existing
-- "Admins or owner read/upload/update/delete employee photos" policies on
-- storage.objects. file_size_limit and allowed_mime_types are a defense-
-- in-depth cap matching the upload form's accept="image/*": nothing in
-- the app enforces a size/type limit today, so without this, RLS alone
-- would let any admin/hr_admin upload arbitrarily large or non-image
-- files under the bucket.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-photos',
  'employee-photos',
  false,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ============ verify ============
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'employee-photos';
