/** src/services/drivers — public barrel. Keeps callsites short. */

export {
  LICENSE_CATEGORIES,
  getLicenseCategory,
  categoryShortLabel,
  categoryEmoji,
} from './licenseCategories';

export {
  createExternalDriver,
  updateExternalDriver,
  archiveExternalDriver,
  listExternalDrivers,
  getExternalDriver,
} from './externalDrivers';

export {
  assignRegisteredDriver,
  assignExternalDriver,
  endDriverAssignment,
  listActiveAssignments,
  listAssignmentsForExternalDriver,
} from './assignments';
