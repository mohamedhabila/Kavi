// ---------------------------------------------------------------------------
// Tests — MCP Presets
// ---------------------------------------------------------------------------

import {
  MCP_PRESETS,
  MCP_PRESET_CATEGORIES,
  getPresetsByCategory,
  searchPresets,
  type McpPreset,
} from '../../src/constants/mcpPresets';

describe('MCP_PRESETS', () => {
  it('contains at least 10 presets', () => {
    expect(MCP_PRESETS.length).toBeGreaterThanOrEqual(10);
  });

  it('each preset has required fields', () => {
    for (const preset of MCP_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.category).toBeTruthy();
      expect(preset.icon).toBeTruthy();
      expect(preset.config).toBeDefined();
      expect(preset.config.name).toBeTruthy();
      expect(preset.config.url).toBeTruthy();
      expect(preset.config.enabled).toBe(true);
      expect(Array.isArray(preset.requiredInputs)).toBe(true);
    }
  });

  it('has unique preset IDs', () => {
    const ids = MCP_PRESETS.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('each preset category is in MCP_PRESET_CATEGORIES', () => {
    const validCategories = MCP_PRESET_CATEGORIES.map((c) => c.key);
    for (const preset of MCP_PRESETS) {
      expect(validCategories).toContain(preset.category);
    }
  });

  describe('required inputs', () => {
    it('each input has key, label, and secret flag', () => {
      for (const preset of MCP_PRESETS) {
        for (const input of preset.requiredInputs) {
          expect(input.key).toBeTruthy();
          expect(input.label).toBeTruthy();
          expect(typeof input.secret).toBe('boolean');
          expect(typeof input.required).toBe('boolean');
        }
      }
    });

    it('GitHub preset requires authorization header', () => {
      const github = MCP_PRESETS.find((p) => p.id === 'preset-github');
      expect(github).toBeDefined();
      expect(github!.requiredInputs.length).toBeGreaterThan(0);
      expect(github!.requiredInputs[0].secret).toBe(true);
    });

    it('Memory preset has no required inputs', () => {
      const memory = MCP_PRESETS.find((p) => p.id === 'preset-memory');
      expect(memory).toBeDefined();
      expect(memory!.requiredInputs.length).toBe(0);
    });
  });
});

describe('MCP_PRESET_CATEGORIES', () => {
  it('has at least 5 categories', () => {
    expect(MCP_PRESET_CATEGORIES.length).toBeGreaterThanOrEqual(5);
  });

  it('each category has key, label, and icon', () => {
    for (const cat of MCP_PRESET_CATEGORIES) {
      expect(cat.key).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.icon).toBeTruthy();
    }
  });
});

describe('getPresetsByCategory', () => {
  it('returns only presets matching the category', () => {
    const devPresets = getPresetsByCategory('development');
    expect(devPresets.length).toBeGreaterThan(0);
    for (const p of devPresets) {
      expect(p.category).toBe('development');
    }
  });

  it('returns empty array for unused category', () => {
    const result = getPresetsByCategory('finance');
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('searchPresets', () => {
  it('returns all presets for empty query', () => {
    const result = searchPresets('');
    expect(result.length).toBe(MCP_PRESETS.length);
  });

  it('finds GitHub preset by name', () => {
    const result = searchPresets('github');
    expect(result.some((p) => p.id === 'preset-github')).toBe(true);
  });

  it('finds PostgreSQL by description keywords', () => {
    const result = searchPresets('database');
    expect(result.some((p) => p.name === 'PostgreSQL')).toBe(true);
  });

  it('is case-insensitive', () => {
    const result = searchPresets('SLACK');
    expect(result.some((p) => p.name === 'Slack')).toBe(true);
  });

  it('returns empty array for no matches', () => {
    const result = searchPresets('xyznonexistent');
    expect(result.length).toBe(0);
  });
});
