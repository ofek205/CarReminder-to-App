/**
 * Accident write commands.
 *
 * All entity-layer (db.accidents.*) — pure routing, behavior-identical. Both
 * commands return a promise the caller can still race: AddAccident wraps the
 * save in its own Promise.race against a 15s timeout (guarding the "loads but
 * doesn't save" TestFlight symptom), and that keeps working unchanged.
 *
 * offlineCapable: single-row, owner-scoped. Accident photos are uploaded
 * separately, so the same Phase-5 upload-queue caveat as documents applies.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

defineCommand('accident.create', {
  offlineCapable: true,
  table: 'accidents',
  run: (payload) => db.accidents.create(payload),
});

defineCommand('accident.update', {
  offlineCapable: true,
  table: 'accidents',
  run: ({ id, ...changes }) => db.accidents.update(id, changes),
});
