/**
 * DAL — the unified Data Access seam.
 *
 * Usage in a screen:
 *   import { dal } from '@/lib/dal';
 *   await dal.run('expense.create', payload);
 *
 * Importing this module registers every command (the ./commands/* imports run
 * for their side-effect of calling defineCommand). Add a new domain by creating
 * ./commands/<domain>.js and importing it here.
 *
 * See docs/offline-architecture-spec.md for the architecture + the offline
 * roadmap (read-cache → outbox → sync) that this seam unlocks.
 */
import { runCommand } from './run';

// --- command registrations (side-effect imports) ---------------------------
import './commands/expenses';
import './commands/corkNotes';
import './commands/vehicles';

export const dal = {
  run: runCommand,
};

export { runCommand } from './run';
export { allCommands } from './registry';
