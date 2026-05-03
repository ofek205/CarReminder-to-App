/**
 * src/services/expenses — public entry.
 * Keep this barrel small so call sites don't import deep paths.
 */
export {
  EXPENSE_CATEGORIES,
  MANUAL_EXPENSE_CATEGORIES,
  SOURCE_BADGE,
  getCategory,
  categoryLabel,
  categoryEmoji,
} from './categories';

export {
  listVehicleExpenses,
  getExpenseDateBounds,
} from './readExpenses';

export {
  createManualExpense,
  updateManualExpense,
  deleteManualExpense,
} from './writeExpenses';

export {
  exportExpensesXlsx,
} from './exportExcel';
