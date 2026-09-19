/**
 * Document write commands.
 *
 * All entity-layer (db.documents.*) — pure routing, behavior-identical.
 * document.create returns the created row: Documents.jsx checks the result
 * (`if (!created) throw`) so the return value must pass straight through.
 *
 * offlineCapable: the row itself is a single owner-scoped insert. The FILE it
 * points at is uploaded separately (useFileUpload / uploadToBucket) — queueing
 * that upload is Phase 5, so an offline document create only becomes genuinely
 * useful once the upload queue exists.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

defineCommand('document.create', {
  offlineCapable: true,
  table: 'documents',
  run: (payload) => db.documents.create(payload),
});

/**
 * Attach a file to a document row that has none, or otherwise patch it.
 *
 * offlineCapable stays FALSE, unlike its create sibling. The only caller
 * today first uploads a file to Storage and then points the row at it, and
 * that upload cannot be queued (see the note above — the outbox for files
 * is Phase 5). Queueing the row patch alone would replay it later against
 * a file_url and storage_path that were never written, which is a worse
 * failure than refusing while offline.
 *
 * RLS: `documents_update` re-checks `user_can_edit_account(account_id)` in
 * its WITH CHECK, so the NEW row's account is validated and a caller
 * cannot move a document into an account it may not edit. Verified live
 * 2026-09-19 before this command was written, because a June audit had
 * flagged that WITH CHECK as missing; it is present now.
 */
defineCommand('document.update', {
  offlineCapable: false,
  table: 'documents',
  run: ({ id, ...changes }) => db.documents.update(id, changes),
});

defineCommand('document.delete', {
  offlineCapable: true,
  table: 'documents',
  run: ({ id }) => db.documents.delete(id),
});
