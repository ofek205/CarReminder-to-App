/**
 * Expense write commands.
 *
 * Expenses are RLS-locked to SECURITY DEFINER RPCs (direct UPDATE is blocked),
 * so these commands wrap the existing expense service rather than table CRUD —
 * which is exactly why the registry supports an arbitrary `run`, not just
 * entity-layer create/update/delete. The service (src/services/expenses) stays
 * the implementation; the registry just becomes the single way screens reach it.
 *
 * offlineCapable: true — single-row, owner-scoped, plausibly entered in the
 * field (snap a fuel/parking expense on the spot). The receipt-upload path is a
 * separate concern handled in Phase 5 (file-upload queue); the write itself is
 * offline-capable. Phase 0 does not yet act on this flag.
 */
import { defineCommand } from '../registry';
import {
  createManualExpense,
  updateManualExpense,
  deleteManualExpense,
} from '@/services/expenses';

defineCommand('expense.create', {
  offlineCapable: true,
  table: 'vehicle_expenses',
  run: (payload) => createManualExpense(payload),
});

defineCommand('expense.update', {
  offlineCapable: true,
  table: 'vehicle_expenses',
  run: ({ id, ...changes }) => updateManualExpense(id, changes),
});

defineCommand('expense.delete', {
  offlineCapable: true,
  table: 'vehicle_expenses',
  run: ({ id }) => deleteManualExpense(id),
});
