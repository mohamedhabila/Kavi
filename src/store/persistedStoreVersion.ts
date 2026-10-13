/**
 * The `migrate` every persisted store uses. Kavi keeps no compatibility with earlier storage
 * shapes (pre-release): state a store persisted under another version is dropped, and the
 * store starts over from its defaults and rewrites itself at the current version, as the
 * memory database and the execution journal already do. State at the current version is
 * never passed here; it loads unchanged.
 */
export function startOverFromOtherVersion<PersistedState>(): PersistedState {
  // zustand merges an undefined migration result as "nothing persisted".
  return undefined as unknown as PersistedState;
}
