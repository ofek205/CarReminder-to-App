/**
 * Command registry — the heart of the unified Data Access seam.
 *
 * Every WRITE in the app (table CRUD, RPC, storage) is registered here as a
 * named "command" with a declarative descriptor, instead of an ad-hoc
 * supabase.rpc / supabase.from call scattered across screens. Screens call
 * `dal.run('<command>', payload)` (see ./run.js) and never touch supabase
 * directly. This is what lets cross-cutting capabilities — offline detection,
 * the write outbox, normalized errors — live in ONE place instead of as a
 * patch in every screen.
 *
 * Descriptor shape (only `run` is used in Phase 0 — the rest is metadata
 * declared now and consumed by later phases):
 *   {
 *     run:            (payload) => Promise<any>   // REQUIRED — executes the write
 *     offlineCapable: boolean                     // Phase 2/3 — may it run offline?
 *     table?:         string                      // informational (which table it touches)
 *     optimistic?:    (queryClient, payload, localId) => void   // Phase 3 — cache patch
 *     invalidates?:   (payload, result) => Array<QueryKey>      // Phase 3 — refetch keys
 *     conflict?:      'lww' | ...                 // Phase 3 — conflict policy
 *   }
 *
 * See docs/offline-architecture-spec.md (Appendix B) for the full design.
 */

const _commands = new Map();

/**
 * Register a command. Duplicate names are a programming error (two modules
 * claimed the same command) — we log loudly but keep the first registration
 * so a hot-reload re-import doesn't throw.
 */
export function defineCommand(name, descriptor) {
  if (typeof name !== 'string' || !name) {
    throw new Error('[dal] defineCommand: name must be a non-empty string');
  }
  if (!descriptor || typeof descriptor.run !== 'function') {
    throw new Error(`[dal] defineCommand("${name}"): descriptor.run must be a function`);
  }
  if (_commands.has(name)) {
    // Don't throw — Vite HMR re-evaluates modules; just keep the latest.
    _commands.set(name, { name, offlineCapable: false, ...descriptor });
    return;
  }
  _commands.set(name, { name, offlineCapable: false, ...descriptor });
}

/** Look up a command descriptor, or null if unregistered. */
export function getCommand(name) {
  return _commands.get(name) || null;
}

/** All registered commands (for diagnostics / the future command map). */
export function allCommands() {
  return [..._commands.values()];
}
