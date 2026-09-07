/**
 * Vessel-issue write commands (the "תקלות" list on vessels/vehicles).
 *
 * All entity-layer (db.vessel_issues.*) — pure routing, behavior-identical.
 * offlineCapable: single-row, owner-scoped, no files/children.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

defineCommand('vesselIssue.create', {
  offlineCapable: true,
  table: 'vessel_issues',
  run: (payload) => db.vessel_issues.create(payload),
});

defineCommand('vesselIssue.update', {
  offlineCapable: true,
  table: 'vessel_issues',
  run: ({ id, ...changes }) => db.vessel_issues.update(id, changes),
});

defineCommand('vesselIssue.delete', {
  offlineCapable: true,
  table: 'vessel_issues',
  run: ({ id }) => db.vessel_issues.delete(id),
});
