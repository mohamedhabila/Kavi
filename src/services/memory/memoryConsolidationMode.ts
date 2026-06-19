// ---------------------------------------------------------------------------
// Kavi — Memory consolidation mode
// ---------------------------------------------------------------------------
// Structural settings mapping for enrichment provider selection. No language
// heuristics — modes select provider tiers, not message content.
// ---------------------------------------------------------------------------

export type MemoryConsolidationMode =
  | 'auto'
  | 'local'
  | 'active_provider'
  | 'specific'
  | 'off';

export interface MemoryConsolidationSettingsSlice {
  memoryConsolidationMode?: unknown;
  consolidationProvider?: string | null;
}

const MEMORY_CONSOLIDATION_MODES = new Set<MemoryConsolidationMode>([
  'auto',
  'local',
  'active_provider',
  'specific',
  'off',
]);

export function normalizeMemoryConsolidationMode(value: unknown): MemoryConsolidationMode {
  if (typeof value === 'string' && MEMORY_CONSOLIDATION_MODES.has(value as MemoryConsolidationMode)) {
    return value as MemoryConsolidationMode;
  }
  return 'auto';
}

export function deriveMemoryConsolidationModeFromSettings(
  settings: MemoryConsolidationSettingsSlice,
): MemoryConsolidationMode {
  if (settings.memoryConsolidationMode !== undefined) {
    return normalizeMemoryConsolidationMode(settings.memoryConsolidationMode);
  }

  const providerId = (settings.consolidationProvider ?? '').trim();
  return providerId ? 'specific' : 'auto';
}

export function resolveConsolidationProviderIdForMode(
  mode: MemoryConsolidationMode,
  consolidationProvider: string | null | undefined,
): string | null {
  if (mode !== 'specific') {
    return null;
  }
  const trimmed = (consolidationProvider ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isMemoryConsolidationEnrichmentEnabled(mode: MemoryConsolidationMode): boolean {
  return mode !== 'off';
}