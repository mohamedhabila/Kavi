// ---------------------------------------------------------------------------
// Tests for skill auto-discovery (discoverSkillsInDirectory)
// ---------------------------------------------------------------------------

// The discoverSkillsInDirectory function uses dynamic import('expo-file-system')
// which doesn't work in Jest without --experimental-vm-modules.
// We test via the public interface: it should handle failures gracefully.

import { discoverSkillsInDirectory, useSkillsStore } from '../../src/services/skills/manager';

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => 'test-id-001'),
}));

// Reset store between tests
beforeEach(() => {
  jest.clearAllMocks();
  useSkillsStore.setState({ entries: [] });
});

describe('discoverSkillsInDirectory', () => {
  it('returns empty array when expo-file-system is not available', async () => {
    // In test env, dynamic import of expo-file-system will fail
    // The function should catch the error and return empty array
    const result = await discoverSkillsInDirectory('/nonexistent');
    expect(result).toEqual([]);
  });

  it('does not throw when called with any path', async () => {
    await expect(discoverSkillsInDirectory('/any/path')).resolves.not.toThrow();
  });

  it('returns an array', async () => {
    const result = await discoverSkillsInDirectory('/test');
    expect(Array.isArray(result)).toBe(true);
  });

  it('does not modify store when no skills found', async () => {
    const entriesBefore = useSkillsStore.getState().entries.length;
    await discoverSkillsInDirectory('/empty');
    const entriesAfter = useSkillsStore.getState().entries.length;
    expect(entriesAfter).toBe(entriesBefore);
  });
});
