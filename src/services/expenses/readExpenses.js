/**
 * Read service for the Expenses screen.
 *
 * Single round-trip per page: fn_list_vehicle_expenses returns rows +
 * filter-aware totals + has_more in one call. The frontend never sums
 * amounts itself — totals come from the RPC.
 *
 * Phase 2 (aggregate mode): vehicleId may be null → totals + rows are
 * aggregated across every vehicle the user can see in the given account.
 * accountId is required in both modes (drives RLS scoping at the SQL level
 * and is part of the new RPC signature).
 */
import { supabase } from '@/lib/supabase';

/**
 * @param {object} args
 * @param {string}    args.accountId   required — scopes the read to one workspace.
 * @param {?string}   args.vehicleId   null = aggregate across all vehicles in the account.
 * @param {string}    args.from        YYYY-MM-DD inclusive
 * @param {string}    args.to          YYYY-MM-DD inclusive
 * @param {?string[]} [args.categories]  null/empty = all
 * @param {number}    [args.page]      0-based, default 0
 * @param {number}    [args.pageSize]  default 30
 *
 * @returns {Promise<{
 *   rows: Array<{
 *     id: string, account_id: string, vehicle_id: string,
 *     amount: number, currency: string, category: string,
 *     expense_date: string, note: ?string, vendor: ?string,
 *     receipt_url: ?string,
 *     source_type: 'expense'|'maintenance'|'repair',
 *     source_id: string,
 *     editable: boolean,
 *   }>,
 *   totals: {
 *     total: number, count: number,
 *     by_category: Record<string, number>,
 *     by_source:   Record<string, number>,
 *     by_vehicle:  Record<string, {
 *       total: number, count: number,
 *       name: string, nickname: ?string,
 *       manufacturer: ?string, model: ?string,
 *       license_plate: ?string, vehicle_type: ?string,
 *     }>,
 *   },
 *   hasMore: boolean,
 * }>}
 */
export async function listVehicleExpenses({
  accountId,
  vehicleId = null,
  from,
  to,
  categories = null,
  page = 0,
  pageSize = 30,
}) {
  if (!accountId) throw new Error('listVehicleExpenses: accountId required');
  if (!from || !to) throw new Error('listVehicleExpenses: from/to required');

  const cats = Array.isArray(categories) && categories.length > 0 ? categories : null;
  const { data, error } = await supabase.rpc('fn_list_vehicle_expenses', {
    p_account_id: accountId,
    p_vehicle_id: vehicleId,           // may be null → aggregate
    p_from:       from,
    p_to:         to,
    p_categories: cats,
    p_limit:      pageSize,
    p_offset:     page * pageSize,
  });
  if (error) throw error;

  const totals = data?.totals || {};
  return {
    rows:    Array.isArray(data?.rows) ? data.rows : [],
    totals: {
      total:       Number(totals.total) || 0,
      count:       Number(totals.count) || 0,
      by_category: totals.by_category || {},
      by_source:   totals.by_source   || {},
      by_vehicle:  totals.by_vehicle  || {},
    },
    hasMore: !!data?.has_more,
  };
}

/**
 * Earliest + latest expense_date across all 3 sources.
 * Used to populate the "year picker" in the UI so we don't show empty years.
 *
 * @param {object} args
 * @param {string}  args.accountId  required
 * @param {?string} [args.vehicleId]  null = bounds across all vehicles
 */
export async function getExpenseDateBounds({ accountId, vehicleId = null }) {
  if (!accountId) return { earliest: null, latest: null };
  const { data, error } = await supabase.rpc('fn_vehicle_expense_date_bounds', {
    p_account_id: accountId,
    p_vehicle_id: vehicleId,
  });
  if (error) throw error;
  return {
    earliest: data?.earliest || null,
    latest:   data?.latest   || null,
  };
}
