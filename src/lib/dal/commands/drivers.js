/**
 * Driver write commands — external (non-registered) drivers and the
 * driver↔vehicle assignment table.
 *
 * These wrap the existing src/services/drivers helpers rather than calling
 * supabase directly: those helpers already normalize (throw on error, return
 * the id), so the registry just becomes the single way screens reach them —
 * the same arrangement as the expenses service.
 *
 * ALL offlineCapable: false. An assignment grants a specific person access to a
 * specific vehicle, and the external-driver records carry licence data other
 * managers act on — multi-writer, role-sensitive, server-arbitrated. Same §3
 * reasoning as the access-control commands.
 */
import { defineCommand } from '../registry';
import {
  createExternalDriver,
  updateExternalDriver,
  archiveExternalDriver,
  assignRegisteredDriver,
  assignExternalDriver,
  endDriverAssignment,
} from '@/services/drivers';

const online = { offlineCapable: false };

defineCommand('externalDriver.create', {
  ...online, table: 'external_drivers',
  run: (payload) => createExternalDriver(payload),
});

defineCommand('externalDriver.update', {
  ...online, table: 'external_drivers',
  run: ({ id, ...changes }) => updateExternalDriver(id, changes),
});

defineCommand('externalDriver.archive', {
  ...online, table: 'external_drivers',
  run: ({ id }) => archiveExternalDriver(id),
});

defineCommand('driverAssignment.assignRegistered', {
  ...online, table: 'driver_assignments',
  run: (payload) => assignRegisteredDriver(payload),
});

defineCommand('driverAssignment.assignExternal', {
  ...online, table: 'driver_assignments',
  run: (payload) => assignExternalDriver(payload),
});

defineCommand('driverAssignment.end', {
  ...online, table: 'driver_assignments',
  run: ({ assignmentId }) => endDriverAssignment(assignmentId),
});
