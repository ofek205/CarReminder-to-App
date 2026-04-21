/**
 * skipperEngine — checklist generation + failed-item handling.
 *
 * Responsibilities:
 *  • Materialise a checklist TEMPLATE into a RUN (jsonb items array)
 *    for a specific vehicle, filtering items by boat attributes.
 *  • Handle failed/blocker items — route them to vessel_issues via the
 *    existing entity (product decision: keep tasks + issues separate).
 *  • Provide small utility helpers used by the UI (stats, section order).
 */

import { db } from './supabaseEntities';
import { SYSTEM_TEMPLATES, SECTION_ORDER, pickTemplateForBoat } from './checklistTemplates';

/**
 * Decide whether a single item's `requires_attrs` are satisfied by the
 * vehicle's stored attributes. Unset vehicle fields count as "maybe" and
 * default to INCLUDING the item, so first-time users aren't silently
 * stripped of items until they configure attributes.
 */
function itemMatchesVehicle(item, vehicle) {
  if (!item.requires_attrs) return true;
  for (const [key, expected] of Object.entries(item.requires_attrs)) {
    const actual = vehicle?.[key];
    if (actual === undefined || actual === null) {
      // Unknown attr → keep item. Better to over-include than hide things
      // the user might need. They can skip individual items at runtime.
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

/**
 * Materialise a template into a run's items array. Filters items by the
 * vehicle's attributes, preserves section ordering by SECTION_ORDER.
 */
export function generateChecklistItems(template, vehicle) {
  if (!template) return [];
  const out = [];
  // Preserve template section order but also enforce the global priority:
  // safety first, shutdown/docking last. If a section isn't in SECTION_ORDER,
  // it falls back to the template's declared position.
  const byPriority = [...template.sections].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.id);
    const bi = SECTION_ORDER.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const section of byPriority) {
    for (const item of section.items) {
      if (!itemMatchesVehicle(item, vehicle)) continue;
      out.push({
        section: section.id,
        section_name: section.name,
        key: item.key,
        name: item.name,
        severity_on_fail: item.severity_on_fail || 'log',
        help: item.help || null,
        state: 'pending',        // pending | passed | failed | skipped
        notes: null,
        decided_at: null,
      });
    }
  }
  return out;
}

/**
 * Compute per-run stats. Used by the UI progress ring + stats jsonb.
 */
export function computeStats(items = []) {
  const stats = { total: items.length, passed: 0, failed: 0, skipped: 0, pending: 0, blockers_failed: 0 };
  for (const it of items) {
    stats[it.state] = (stats[it.state] || 0) + 1;
    if (it.state === 'failed' && it.severity_on_fail === 'blocker') {
      stats.blockers_failed++;
    }
  }
  return stats;
}

/**
 * Entry-point used by OutingsSection when user taps "התחל בדיקה".
 * Picks the right template, materialises items, and returns a draft
 * `checklist_runs` row — NOT yet persisted. Caller decides when to
 * db.checklist_runs.create(...).
 */
export function buildRunDraft({ outing, vehicle, phase }) {
  const template = pickTemplateForBoat(vehicle, phase);
  const items = generateChecklistItems(template, vehicle);
  return {
    outing_id: outing.id,
    vehicle_id: vehicle.id,
    phase,
    template_key: template.key,
    items,
    stats: computeStats(items),
  };
}

/**
 * Create a vessel_issue row from a failed checklist item. Returns the
 * created row. Non-blocking — callers should swallow errors so a DB
 * hiccup doesn't strand the user mid-checklist.
 *
 * The vessel_issues table is the existing "תקלות בסירה" list the user
 * already sees in the boat page — failed items now feed into it so
 * they don't get lost when the run ends.
 */
export async function createIssueFromFailedItem({ vehicle, outing, runItem }) {
  const severityMap = {
    blocker:  'high',
    advisory: 'medium',
    log:      'low',
  };
  const categoryMap = {
    safety:      'safety',
    weather:     'other',
    engine:      'engine',
    fuel:        'engine',
    electrical:  'electrical',
    navigation:  'electrical',
    deck:        'hull',
    sails:       'rigging',
    rigging:     'rigging',
    cleanup:     'other',
    shutdown:    'engine',
    docking:     'hull',
  };
  const outingTag = outing?.name ? ` · ${outing.name}` : '';

  try {
    return await db.vessel_issues.create({
      vehicle_id: vehicle.id,
      account_id: vehicle.account_id,
      title: runItem.name,
      description: [
        `נמצא בבדיקת ${runItem.section_name || ''}${outingTag}`,
        runItem.notes || null,
      ].filter(Boolean).join('\n'),
      category: categoryMap[runItem.section] || 'other',
      priority: severityMap[runItem.severity_on_fail] || 'low',
      status: 'open',
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[skipperEngine] createIssueFromFailedItem failed:', e?.message);
    return null;
  }
}

/**
 * Detect recurring failure: same item key failed 3+ times in the last
 * 30 days for the same vehicle. Triggered when finalising a run, lets
 * the UI nudge the user that this isn't a one-off.
 */
export async function detectRecurringFailure({ vehicle_id, item_key }) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const runs = await db.checklist_runs
      .filter({ vehicle_id });
    const count = (runs || [])
      .filter(r => new Date(r.completed_at || r.created_at) > new Date(since))
      .reduce((acc, r) => {
        const hit = (r.items || []).some(it => it.key === item_key && it.state === 'failed');
        return acc + (hit ? 1 : 0);
      }, 0);
    return count >= 3 ? { recurring: true, count } : { recurring: false, count };
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[skipperEngine] detectRecurringFailure failed:', e?.message);
    return { recurring: false, count: 0 };
  }
}

// Re-export a few things for convenience so consumers import from one place.
export { SYSTEM_TEMPLATES, pickTemplateForBoat };
