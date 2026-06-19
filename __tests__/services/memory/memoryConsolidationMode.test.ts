import {
  deriveMemoryConsolidationModeFromSettings,
  normalizeMemoryConsolidationMode,
  resolveConsolidationProviderIdForMode,
} from '../../../src/services/memory/memoryConsolidationMode';

describe('memoryConsolidationMode', () => {
  it('defaults unknown values to auto', () => {
    expect(normalizeMemoryConsolidationMode('unknown')).toBe('auto');
  });

  it('derives specific mode from legacy consolidationProvider', () => {
    expect(
      deriveMemoryConsolidationModeFromSettings({
        consolidationProvider: 'provider-1',
      }),
    ).toBe('specific');
  });

  it('derives auto mode when no explicit provider is configured', () => {
    expect(
      deriveMemoryConsolidationModeFromSettings({
        consolidationProvider: null,
      }),
    ).toBe('auto');
  });

  it('keeps provider id only for specific mode', () => {
    expect(resolveConsolidationProviderIdForMode('specific', 'provider-1')).toBe('provider-1');
    expect(resolveConsolidationProviderIdForMode('auto', 'provider-1')).toBeNull();
  });
});