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

defineCommand('document.delete', {
  offlineCapable: true,
  table: 'documents',
  run: ({ id }) => db.documents.delete(id),
});
