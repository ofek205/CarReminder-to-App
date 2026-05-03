/**
 * External-driver service — wraps the SECURITY DEFINER RPCs from the
 * supabase-external-drivers migration.
 *
 * "External" = a worker who shows up in the fleet roster but doesn't
 * have an auth.users row. Lives in public.external_drivers, can be
 * assigned to vehicles via driver_assignments.external_driver_id.
 */
import { supabase } from '@/lib/supabase';

/**
 * @param {object} args
 * @param {string} args.accountId    workspace
 * @param {string} args.fullName     required
 * @param {string} args.phone        required
 * @param {?string} args.email
 * @param {?string} args.birthDate           YYYY-MM-DD
 * @param {?string} args.licenseNumber
 * @param {?string} args.licenseExpiryDate   YYYY-MM-DD (optional)
 * @param {string[]} [args.licenseCategories]  catalog codes + free text
 * @param {?string} args.licensePhotoUrl
 * @param {?string} args.licensePhotoStoragePath
 * @param {?string} args.notes
 * @returns {Promise<string>} new driver id
 */
export async function createExternalDriver({
  accountId,
  fullName,
  phone,
  email = null,
  birthDate = null,
  licenseNumber = null,
  licenseExpiryDate = null,
  licenseCategories = [],
  licensePhotoUrl = null,
  licensePhotoStoragePath = null,
  notes = null,
}) {
  if (!accountId) throw new Error('accountId required');
  const { data, error } = await supabase.rpc('create_external_driver', {
    p_account_id:                accountId,
    p_full_name:                 fullName,
    p_phone:                     phone,
    p_email:                     email,
    p_birth_date:                birthDate,
    p_license_number:            licenseNumber,
    p_license_expiry_date:       licenseExpiryDate,
    p_license_categories:        Array.isArray(licenseCategories) ? licenseCategories : [],
    p_license_photo_url:         licensePhotoUrl,
    p_license_photo_storage_path: licensePhotoStoragePath,
    p_notes:                     notes,
  });
  if (error) throw error;
  return data;  // uuid
}

/**
 * Patch an existing external driver. Each `clear*` flag forces the
 * column to NULL (use when the user removed an optional field).
 */
export async function updateExternalDriver(id, {
  fullName,
  phone,
  email,
  clearEmail = false,
  birthDate,
  clearBirthDate = false,
  licenseNumber,
  clearLicenseNumber = false,
  licenseExpiryDate,
  clearLicenseExpiry = false,
  licenseCategories,
  licensePhotoUrl,
  licensePhotoStoragePath,
  clearLicensePhoto = false,
  notes,
  clearNotes = false,
  status,
}) {
  if (!id) throw new Error('id required');
  const { error } = await supabase.rpc('update_external_driver', {
    p_id:                          id,
    p_full_name:                   fullName ?? null,
    p_phone:                       phone ?? null,
    p_email:                       email ?? null,
    p_clear_email:                 !!clearEmail,
    p_birth_date:                  birthDate ?? null,
    p_clear_birth_date:            !!clearBirthDate,
    p_license_number:              licenseNumber ?? null,
    p_clear_license_number:        !!clearLicenseNumber,
    p_license_expiry_date:         licenseExpiryDate ?? null,
    p_clear_license_expiry:        !!clearLicenseExpiry,
    p_license_categories:          Array.isArray(licenseCategories) ? licenseCategories : null,
    p_license_photo_url:           licensePhotoUrl ?? null,
    p_license_photo_storage_path:  licensePhotoStoragePath ?? null,
    p_clear_license_photo:         !!clearLicensePhoto,
    p_notes:                       notes ?? null,
    p_clear_notes:                 !!clearNotes,
    p_status:                      status ?? null,
  });
  if (error) throw error;
  return true;
}

/** Soft-delete: status='archived' + ends every active assignment. */
export async function archiveExternalDriver(id) {
  if (!id) throw new Error('id required');
  const { error } = await supabase.rpc('archive_external_driver', { p_id: id });
  if (error) throw error;
  return true;
}

/**
 * List external drivers for an account. RLS ensures non-members get nothing.
 *   includeArchived=false → status='active' only (default)
 *   includeArchived=true  → all
 */
export async function listExternalDrivers({ accountId, includeArchived = false } = {}) {
  if (!accountId) return [];
  let q = supabase
    .from('external_drivers')
    .select('id, full_name, phone, email, birth_date, license_number, license_expiry_date, license_categories, license_photo_url, license_photo_storage_path, notes, status, created_at, updated_at')
    .eq('account_id', accountId)
    .order('full_name', { ascending: true });
  if (!includeArchived) q = q.eq('status', 'active');
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Single driver by id. Returns null when not found. */
export async function getExternalDriver(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('external_drivers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
