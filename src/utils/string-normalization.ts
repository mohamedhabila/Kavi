// ---------------------------------------------------------------------------
// Kavi — String Normalization
// ---------------------------------------------------------------------------

export function normalizeStringEntries(list?: ReadonlyArray<unknown>) {
  return (list ?? []).map((entry) => String(entry).trim()).filter(Boolean);
}
