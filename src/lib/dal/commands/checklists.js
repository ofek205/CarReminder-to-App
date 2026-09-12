/**
 * Checklist write commands — the TEMPLATE (vessel_checklists) and the RUN
 * (vessel_checklist_runs) are separate tables with separate lifecycles, so they
 * get separate command families.
 *
 * All entity-layer — pure routing, behavior-identical. create returns the
 * created row: ChecklistEditor / ChecklistHub / Checklist all capture it (they
 * need the new id to keep editing the run they just started).
 *
 * offlineCapable: single-row, owner-scoped, no files/children. Checklist runs
 * are one of the strongest offline cases in the app — a user ticks items while
 * walking around a vessel, frequently out of signal — so these are prime
 * candidates once the outbox lands (Phase 3/4).
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

defineCommand('checklist.create', {
  offlineCapable: true,
  table: 'vessel_checklists',
  run: (payload) => db.vessel_checklists.create(payload),
});

defineCommand('checklist.update', {
  offlineCapable: true,
  table: 'vessel_checklists',
  run: ({ id, ...changes }) => db.vessel_checklists.update(id, changes),
});

defineCommand('checklistRun.create', {
  offlineCapable: true,
  table: 'vessel_checklist_runs',
  run: (payload) => db.vessel_checklist_runs.create(payload),
});

defineCommand('checklistRun.update', {
  offlineCapable: true,
  table: 'vessel_checklist_runs',
  run: ({ id, ...changes }) => db.vessel_checklist_runs.update(id, changes),
});
