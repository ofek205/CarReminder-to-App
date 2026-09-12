/**
 * Repair write commands — repair logs (+ their attachment/accident children)
 * and the user's repair-type catalog.
 *
 * `repair.save` wraps the transactional `save_repair_with_children` RPC: one
 * atomic server call that writes repair_logs + repair_attachments +
 * accident_details together (the old flow issued up to 5 separate writes and a
 * mid-flight drop left orphans).
 *
 * ⚠️ repair.save deliberately returns the RAW supabase envelope `{ data, error }`
 * instead of throwing. Both call sites branch on `error` in different ways — one
 * early-returns with a toast, the other throws inside a useMutation — so
 * normalizing it here would change call-site control flow, which is out of scope
 * for Phase 0 (routing only). Normalizing it is a Phase-2 task, tracked in
 * docs/offline-architecture-spec.md.
 *
 * offlineCapable is declared true (owner-scoped, single-writer per §3 of the
 * spec), but its optimistic-apply is HARD — multi-table + file attachments — so
 * it lands late (Phase 4/5), never in the outbox PoC.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';

defineCommand('repair.save', {
  offlineCapable: true,
  table: 'repair_logs',
  kind: 'rpc',
  returnsEnvelope: true, // see the note above — resolves to { data, error }
  run: ({ repairLog, attachments, accident }) =>
    supabase.rpc('save_repair_with_children', {
      p_repair_log: repairLog,
      p_attachments: attachments,
      p_accident: accident,
    }),
});

// Children cascade server-side (FK ON DELETE CASCADE on
// repair_attachments.repair_log_id and accident_details.repair_log_id).
defineCommand('repair.delete', {
  offlineCapable: true,
  table: 'repair_logs',
  run: ({ id }) => db.repair_logs.delete(id),
});

defineCommand('repairType.create', {
  offlineCapable: true,
  table: 'repair_types',
  run: (payload) => db.repair_types.create(payload),
});

defineCommand('repairType.update', {
  offlineCapable: true,
  table: 'repair_types',
  run: ({ id, ...changes }) => db.repair_types.update(id, changes),
});

defineCommand('repairType.delete', {
  offlineCapable: true,
  table: 'repair_types',
  run: ({ id }) => db.repair_types.delete(id),
});
