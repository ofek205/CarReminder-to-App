-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as-storage.sql — Storage read+write for view-as
--
-- Lets the admin VIEW the target's existing photos/documents and UPLOAD new
-- ones during an active view session. Files live in the private bucket
-- "vehicle-files" under {account_id}/... (first path folder = account_id).
--
-- SECURITY:
--   * ADDITIVE policies (OR'd) — do NOT modify the existing vehicle_files_*
--     policies; only ADD an admin path gated on public.is_viewing(account_id).
--   * The regex guard ensures we only cast a UUID-shaped first folder to uuid
--     (the 'scans/{uid}/...' paths have a non-uuid first folder and are skipped
--     — those stay user-private, the admin doesn't need them).
--   * is_viewing() is false for non-admins → zero impact on regular users.
--
-- DEPENDS ON: public.is_viewing(uuid). Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- Read — generating a signed URL requires SELECT on the object, so this is what
-- makes the target's photos/documents render during view-as.
drop policy if exists "view_storage_select" on storage.objects;
create policy "view_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vehicle-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_viewing(((storage.foldername(name))[1])::uuid)
  );

-- Write — upload a new file into the target account's folder.
drop policy if exists "view_storage_insert" on storage.objects;
create policy "view_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vehicle-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_viewing(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "view_storage_update" on storage.objects;
create policy "view_storage_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vehicle-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_viewing(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "view_storage_delete" on storage.objects;
create policy "view_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vehicle-files'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_viewing(((storage.foldername(name))[1])::uuid)
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY: select count(*) from pg_policies
--   where schemaname='storage' and policyname like 'view_storage_%';   -- = 4
-- ═══════════════════════════════════════════════════════════════════════════
