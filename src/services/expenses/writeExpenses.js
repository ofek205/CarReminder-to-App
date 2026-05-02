/**
 * Write service — manual expenses only.
 *
 * Maintenance / repair edits live in their own dialogs and are NOT
 * exposed here on purpose. Calling code can verify `row.editable === true`
 * before invoking these.
 *
 * The RPCs (add_vehicle_expense, update_vehicle_expense, delete_vehicle_expense)
 * accept the full set of expense columns including title / vendor / source.
 * Direct UPDATEs against the table are blocked by RLS — all writes go
 * through the SECURITY DEFINER RPCs.
 */
import { supabase } from '@/lib/supabase';

export async function createManualExpense({
  accountId,
  vehicleId,
  amount,
  category,
  expenseDate,
  title = null,
  note = null,
  vendor = null,
  receiptUrl = null,
  receiptStoragePath = null,
  source = 'manual',     // 'manual' | 'ai_scan'
  currency = 'ILS',
}) {
  if (!accountId)   throw new Error('createManualExpense: accountId required');
  if (!vehicleId)   throw new Error('createManualExpense: vehicleId required');
  if (!category)    throw new Error('createManualExpense: category required');
  if (!expenseDate) throw new Error('createManualExpense: expenseDate required');

  const { data, error } = await supabase.rpc('add_vehicle_expense', {
    p_account_id:           accountId,
    p_vehicle_id:           vehicleId,
    p_amount:               Number(amount),
    p_category:             category,
    p_expense_date:         expenseDate,
    p_note:                 note,
    p_currency:             currency,
    p_receipt_url:          receiptUrl,
    p_receipt_storage_path: receiptStoragePath,
    p_title:                title,
    p_vendor:               vendor,
    p_source:               source,
  });
  if (error) throw error;
  return data;
}

export async function updateManualExpense(id, {
  amount,
  category,
  expenseDate,
  title,
  note,
  vendor,
  receiptUrl,
  receiptStoragePath,
  clearReceipt = false,
  clearTitle = false,
  clearVendor = false,
}) {
  if (!id) throw new Error('updateManualExpense: id required');

  const { error } = await supabase.rpc('update_vehicle_expense', {
    p_id:                   id,
    p_amount:               amount != null ? Number(amount) : null,
    p_category:             category ?? null,
    p_expense_date:         expenseDate ?? null,
    p_note:                 note ?? null,
    p_receipt_url:          receiptUrl ?? null,
    p_receipt_storage_path: receiptStoragePath ?? null,
    p_clear_receipt:        !!clearReceipt,
    p_title:                title ?? null,
    p_vendor:               vendor ?? null,
    p_clear_title:          !!clearTitle,
    p_clear_vendor:         !!clearVendor,
  });
  if (error) throw error;
}

export async function deleteManualExpense(id) {
  if (!id) throw new Error('deleteManualExpense: id required');
  const { error } = await supabase.rpc('delete_vehicle_expense', { p_id: id });
  if (error) throw error;
}
