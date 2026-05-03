// Marker color per stop status. Single source of truth — used by both
// the map (DivIcon background) and any list-view status pill that wants
// to read the same hue.
//
// Spec (phase 12):
//   pending     → gray   (waiting / not started)
//   in_progress → blue   (driver is on this stop)
//   completed   → green  (done)
//   failed      → red    (driver couldn't complete)
//   overdue     → amber  (deadline passed, still open)
//
// Legacy values kept for rows created before the wider enum landed:
//   skipped     → gray   (intentionally not visited)
//   issue       → red    (treated like failed for display)

export const STOP_STATUS_COLORS = {
  pending:     '#9CA3AF', // gray-400
  in_progress: '#3B82F6', // blue-500
  completed:   '#10B981', // emerald-500
  failed:      '#EF4444', // red-500
  overdue:     '#F59E0B', // amber-500
  skipped:     '#9CA3AF', // gray-400 (legacy)
  issue:       '#EF4444', // red-500 (legacy)
};

export const STOP_STATUS_HEBREW = {
  pending:     'מתוזמנת',
  in_progress: 'בביצוע',
  completed:   'הושלמה',
  failed:      'נכשלה',
  overdue:     'באיחור',
  skipped:     'דולגה',
  issue:       'תקלה מדווחת',
};

export function colorForStop(status) {
  return STOP_STATUS_COLORS[status] || STOP_STATUS_COLORS.pending;
}

export function labelForStop(status) {
  return STOP_STATUS_HEBREW[status] || STOP_STATUS_HEBREW.pending;
}

// Index of the next uncompleted stop in a sequence-ordered array, or -1
// when there isn't one (everything is in a terminal state). The "next"
// stop is the first one whose status is NOT in the terminal set:
// completed / skipped / issue / failed. in_progress and overdue still
// count as open so the driver knows what to focus on.
const TERMINAL = new Set(['completed', 'skipped', 'issue', 'failed']);

export function findNextStopIndex(stops) {
  if (!Array.isArray(stops)) return -1;
  // Prefer an in_progress stop if there is one — it is by definition
  // the one the driver is currently at.
  const inProgress = stops.findIndex(s => s.status === 'in_progress');
  if (inProgress !== -1) return inProgress;
  return stops.findIndex(s => !TERMINAL.has(s.status));
}

export function isStopTerminal(status) {
  return TERMINAL.has(status);
}
