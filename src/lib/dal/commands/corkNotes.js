/**
 * Cork-board note + vehicle-task write commands.
 *
 * Notes (CorkBoard) and tasks (TasksSection) both live in the cork_notes table
 * but were written via TWO different mechanisms: CorkBoard used db.cork_notes.*
 * (entity layer) while TasksSection used raw supabase.from('cork_notes').
 * Routing both through db.cork_notes here unifies them onto ONE path — which
 * also means the task writes now get sanitize + withTimeout + throw-on-error
 * (the raw inserts previously swallowed DB errors silently).
 *
 * Note vs task are kept as distinct command names (same impl today) so later
 * phases can give them their own optimistic/invalidation behavior — they
 * invalidate different query keys (['cork-notes'] vs ['tasks-v2']) at the call
 * site. offlineCapable: single-row, owner-scoped.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

defineCommand('corkNote.create', {
  offlineCapable: true,
  table: 'cork_notes',
  run: (payload) => db.cork_notes.create(payload),
});

defineCommand('corkNote.update', {
  offlineCapable: true,
  table: 'cork_notes',
  run: ({ id, ...changes }) => db.cork_notes.update(id, changes),
});

defineCommand('corkNote.delete', {
  offlineCapable: true,
  table: 'cork_notes',
  run: ({ id }) => db.cork_notes.delete(id),
});

defineCommand('task.create', {
  offlineCapable: true,
  table: 'cork_notes',
  run: (payload) => db.cork_notes.create(payload),
});

defineCommand('task.toggleDone', {
  offlineCapable: true,
  table: 'cork_notes',
  run: ({ id, is_done }) => db.cork_notes.update(id, { is_done }),
});

defineCommand('task.delete', {
  offlineCapable: true,
  table: 'cork_notes',
  run: ({ id }) => db.cork_notes.delete(id),
});
