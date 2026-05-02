/**
 * Read service for the Expenses screen.
 *
 * Single round-trip per page: fn_list_vehicle_expenses returns rows +
 * filter-aware totals + has_more in one call. The frontend never sums
 * amounts itself — totals come from the RPC.
 */
import { supabase } from '@/lib/supabase';

/**
 * @param {object} args
 * @param {string} args.vehicleId    required
 * @param {string} args.from         YYYY-MM-DD inclusive
 * @param {string} args.to           YYYY-MM-DD inclusive
 * @param {string[]} [args.categories]  null/empty = all
 * @param {number} [args.page]       0-based, default 0
 * @param {number} [args.pageSize]   default 30
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
 *   },
 *   hasMore: boolean,
 * }>}
 */
export async function listVehicleExpenses({
  vehicleId,
  from,
  to,
  categories = null,
  page = 0,
  pageSize = 30,
}) {
  if (!vehicleId) throw new Error('listVehicleExpenses: vehicleId required');
  if (!from || !to) throw new Error('listVehicleExpenses: from/to required');

  const cats = Array.isArray(categories) && categories.length > 0 ? categories : null;
  const { data, error } = await supabase.rpc('fn_list_vehicle_expenses', {
    p_vehicle_id: vehicleId,
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
    },
    hasMore: !!data?.has_more,
  };
}

/**
 * Earliest + latest expense_date across all 3 sources for this vehicle.
 * Used to populate the "year picker" in the UI so we don't show empty years.
 */
export async function getExpenseDateBounds({ vehicleId }) {
  if (!vehicleId) return { earliest: null, latest: null };
  const { data, error } = await supabase.rpc('fn_vehicle_expense_date_bounds', {
    p_vehicle_id: vehicleId,
  });
  if (error) throw error;
  return {
    earliest: data?.earliest || null,
    latest:   data?.latest   || null,
  };
}
