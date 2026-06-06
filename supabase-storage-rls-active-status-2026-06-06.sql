-- ═══════════════════════════════════════════════════════════════════════════
-- M4 — vehicle-files storage RLS: enforce active-member status + read/write split
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG (audit, confirmed live): all four vehicle-files policies matched ANY row
-- in account_members for the user — with NO status='פעיל' filter and NO role
-- split. So a suspended/removed member (row kept, status flipped) retained
-- full read/write/delete on license scans, insurance docs and accident photos,
-- and a read-only שותף could upload/delete files.
--
-- FIX: SELECT = any ACTIVE member of the account; INSERT/UPDATE/DELETE = ACTIVE
-- בעלים/מנהל only (mirrors the documents table write rule). The personal
-- scans/{uid} path stays owner-of-path for all verbs (user's own upload area).
-- ═══════════════════════════════════════════════════════════════════════════

-- READ: any active member.
ALTER POLICY vehicle_files_select ON storage.objects
  USING (
    bucket_id = 'vehicle-files'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT account_id::text FROM account_members
        WHERE user_id = auth.uid() AND status = 'פעיל'
      )
      OR ((storage.foldername(name))[1] = 'scans' AND (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

-- WRITE (insert): active owner/manager, or own scans path.
ALTER POLICY vehicle_files_insert ON storage.objects
  WITH CHECK (
    bucket_id = 'vehicle-files'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT account_id::text FROM account_members
        WHERE user_id = auth.uid() AND status = 'פעיל' AND role IN ('בעלים','מנהל')
      )
      OR ((storage.foldername(name))[1] = 'scans' AND (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

-- WRITE (update): active owner/manager, or own scans path.
ALTER POLICY vehicle_files_update ON storage.objects
  USING (
    bucket_id = 'vehicle-files'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT account_id::text FROM account_members
        WHERE user_id = auth.uid() AND status = 'פעיל' AND role IN ('בעלים','מנהל')
      )
      OR ((storage.foldername(name))[1] = 'scans' AND (storage.foldername(name))[2] = auth.uid()::text)
    )
  );

-- WRITE (delete): active owner/manager, or own scans path.
ALTER POLICY vehicle_files_delete ON storage.objects
  USING (
    bucket_id = 'vehicle-files'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT account_id::text FROM account_members
        WHERE user_id = auth.uid() AND status = 'פעיל' AND role IN ('בעלים','מנהל')
      )
      OR ((storage.foldername(name))[1] = 'scans' AND (storage.foldername(name))[2] = auth.uid()::text)
    )
  );
