/**
 * runCommand — the single entry point for every write in the app.
 *
 * PHASE 0 (current): pure routing. It looks the command up and executes its
 * run(). Behavior is IDENTICAL to calling the underlying supabase/service
 * directly — this phase only consolidates WHERE writes happen, not how they
 * behave. That keeps Phase 0 a safe, reviewable, behavior-preserving refactor.
 *
 * LATER PHASES land here, in ONE place (see docs/offline-architecture-spec.md):
 *   - Phase 2: offline fast-fail — if offline and !cmd.offlineCapable, throw a
 *     clean OfflineError (replaces the 8 scattered try/catch patches).
 *   - Phase 3: offline-capable commands apply optimistically to the cache +
 *     enqueue to a durable outbox, flushed on reconnect.
 */
import { getCommand } from './registry';

export async function runCommand(name, payload) {
  const cmd = getCommand(name);
  if (!cmd) {
    // A typo / unregistered command is a programming error — fail loudly
    // rather than silently no-op a user's write.
    throw new Error(`[dal] unknown command: "${name}"`);
  }
  return cmd.run(payload);
}
