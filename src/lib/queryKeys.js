/**
 * Query keys that more than one place has to agree on.
 *
 * A key duplicated as two literals is a drift waiting to happen, and the
 * failure is silent: the reader keys off one shape, the writer off another, and
 * the write lands somewhere nothing reads. Nothing errors, nothing logs, and it
 * looks like it worked. Phase 4 hit exactly this with the outbox's optimistic
 * patch; the fix there, as here, is one declaration.
 *
 * Only add a key here when a SECOND caller needs it. A key used in one place
 * belongs next to its useQuery.
 */

/**
 * The Documents page's list query (src/pages/Documents.jsx).
 *
 * Shared with usePrefetchOfflineEssentials, which warms this exact query so a
 * first offline visit shows documents instead of an empty list.
 *
 * `vehicleId` comes from `URLSearchParams.get('vehicle_id')`, so it is `null`
 * when absent, and `driverAssignedVehicleIds` is `null` until its own query
 * resolves — hence the optional chain, which yields `undefined`. React Query
 * hashes keys with JSON.stringify, where `null` and `undefined` in the same
 * array position are equivalent, so those two do not actually diverge. The
 * expressions are kept faithful to the page anyway rather than "simplified",
 * because the next person should be able to compare them without knowing that.
 */
export function documentsListKey({
  accountId,
  vehicleId = null,
  restrictToDriverAssignments = false,
  driverAssignedVehicleIds = null,
} = {}) {
  return [
    'documents',
    accountId,
    vehicleId,
    restrictToDriverAssignments,
    driverAssignedVehicleIds?.join(','),
  ];
}
