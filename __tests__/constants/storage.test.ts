// ---------------------------------------------------------------------------
// Tests — Constants: Storage Keys
// ---------------------------------------------------------------------------

import { STORAGE_KEYS } from '../../src/constants/storage';

describe('STORAGE_KEYS', () => {
  it('should have SETTINGS key', () => {
    expect(STORAGE_KEYS.SETTINGS).toBe('kavi_settings');
  });

  it('should have CONVERSATIONS key', () => {
    expect(STORAGE_KEYS.CONVERSATIONS).toBe('kavi_conversations');
  });

  it('should have ONBOARDED key', () => {
    expect(STORAGE_KEYS.ONBOARDED).toBe('kavi_onboarded');
  });

  it('all keys should be prefixed with kavi_', () => {
    for (const key of Object.values(STORAGE_KEYS)) {
      expect(key).toMatch(/^kavi_/);
    }
  });
});
