// ---------------------------------------------------------------------------
// Tests — i18n Manager
// ---------------------------------------------------------------------------

import { clearLocaleCache } from '../../src/i18n/registry';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'en-US' }]),
}));

// We need a fresh manager for each test, so we use dynamic import and jest.resetModules
let i18n: (typeof import('../../src/i18n/manager'))['i18n'];
let AsyncStorage: { getItem: jest.Mock; setItem: jest.Mock };
let mockGetLocales: jest.Mock;

function setDeviceLocaleTag(languageTag: string | null): void {
  if (languageTag === null) {
    mockGetLocales.mockImplementation(() => {
      throw new Error('device locale unavailable');
    });
    return;
  }
  mockGetLocales.mockReturnValue([{ languageTag }]);
}

beforeEach(() => {
  jest.resetModules();
  clearLocaleCache();

  // Re-import mocks and module AFTER resetModules so they share the same instance
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
  AsyncStorage.getItem.mockReset().mockResolvedValue(null);
  AsyncStorage.setItem.mockReset().mockResolvedValue(undefined);

  mockGetLocales = require('expo-localization').getLocales as jest.Mock;
  mockGetLocales.mockReset();
  setDeviceLocaleTag('en-US');

  const mod = require('../../src/i18n/manager');
  i18n = mod.i18n;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('I18nManager', () => {
  describe('init', () => {
    it('defaults to English locale before init resolves', () => {
      expect(i18n.locale).toBe('en');
      expect(i18n.localePreference).toBe('system');
    });

    it('loads a persisted explicit locale from AsyncStorage and keeps it (no surprise switch)', async () => {
      AsyncStorage.getItem.mockResolvedValue('fr');
      setDeviceLocaleTag('de-DE');
      await i18n.init();
      expect(i18n.locale).toBe('fr');
      expect(i18n.localePreference).toBe('fr');
    });

    it('follows the device locale when nothing is stored (fresh install)', async () => {
      setDeviceLocaleTag('ar-EG');
      await i18n.init();
      expect(i18n.locale).toBe('ar');
      expect(i18n.localePreference).toBe('system');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('kavi_locale', 'system');
    });

    it('maps a device tag with a script subtag to the right supported locale (zh-Hant-TW → zh-TW)', async () => {
      setDeviceLocaleTag('zh-Hant-TW');
      await i18n.init();
      expect(i18n.locale).toBe('zh-TW');
    });

    it('resolves via the device locale when the stored preference is the "system" sentinel', async () => {
      AsyncStorage.getItem.mockResolvedValue('system');
      setDeviceLocaleTag('ja-JP');
      await i18n.init();
      expect(i18n.locale).toBe('ja');
      expect(i18n.localePreference).toBe('system');
    });

    it('recovers to following the device locale on an unrecognized stored value', async () => {
      AsyncStorage.getItem.mockResolvedValue('xx-not-a-locale');
      setDeviceLocaleTag('es-MX');
      await i18n.init();
      expect(i18n.locale).toBe('es');
      expect(i18n.localePreference).toBe('system');
    });

    it('init is idempotent', async () => {
      AsyncStorage.getItem.mockResolvedValue('de');
      await i18n.init();
      expect(i18n.locale).toBe('de');

      // Change mock, but init should not run again
      AsyncStorage.getItem.mockResolvedValue('fr');
      await i18n.init();
      expect(i18n.locale).toBe('de');
    });

    it('gracefully handles AsyncStorage failure', async () => {
      AsyncStorage.getItem.mockRejectedValue(new Error('fail'));
      await i18n.init();
      expect(i18n.locale).toBe('en');
    });
  });

  describe('setLocale', () => {
    it('changes the locale and pins the preference to that locale', async () => {
      await i18n.setLocale('fr');
      expect(i18n.locale).toBe('fr');
      expect(i18n.localePreference).toBe('fr');
    });

    it('persists locale to AsyncStorage', async () => {
      await i18n.setLocale('de');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('kavi_locale', 'de');
    });

    it('loads corresponding translations', async () => {
      await i18n.setLocale('es');
      expect(i18n.translations.common).toBeDefined();
    });

    it('notifies subscribers on change', async () => {
      const listener = jest.fn();
      i18n.subscribe(listener);
      await i18n.setLocale('ja');
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('setLocalePreference', () => {
    it('re-resolves the device locale each time "system" is set', async () => {
      await i18n.setLocale('fr');
      expect(i18n.locale).toBe('fr');

      setDeviceLocaleTag('de-DE');
      await i18n.setLocalePreference('system');
      expect(i18n.locale).toBe('de');
      expect(i18n.localePreference).toBe('system');
      expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('kavi_locale', 'system');

      // A later device-locale change is picked up the next time "system" is (re)applied.
      setDeviceLocaleTag('ja-JP');
      await i18n.setLocalePreference('system');
      expect(i18n.locale).toBe('ja');
    });

    it('an explicit locale selection clears a prior "system" preference', async () => {
      setDeviceLocaleTag('ar-EG');
      await i18n.setLocalePreference('system');
      expect(i18n.localePreference).toBe('system');

      await i18n.setLocale('de');
      expect(i18n.localePreference).toBe('de');
      expect(i18n.locale).toBe('de');
    });
  });

  describe('t (translate)', () => {
    it('resolves simple dot-delimited keys', () => {
      const result = i18n.t('common.ok');
      expect(result).toBe('OK');
    });

    it('resolves nested keys', () => {
      const result = i18n.t('chat.noProvider');
      expect(result).toBe('No provider configured. Go to Settings to add one.');
    });

    it('returns the key for missing translations', () => {
      const result = i18n.t('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    it('interpolates parameters', () => {
      const result = i18n.t('chat.toolCall', { name: 'web_fetch' });
      expect(result).toBe('Using tool: web_fetch');
    });

    it('interpolates multiple parameters', () => {
      const result = i18n.t('scheduler.deleteJobConfirm', { name: 'Test Job' });
      expect(result).toContain('Test Job');
    });

    it('handles numeric parameter values', () => {
      const result = i18n.t('mcpStatus.tools', { count: 5 });
      expect(result).toBe('5 tools');
    });

    it('falls back to English for missing keys in other locale', async () => {
      await i18n.setLocale('fr');
      // Even if fr locale is loaded, a key present in en should fallback
      const result = i18n.t('common.ok');
      expect(result).toBeTruthy();
    });
  });

  describe('t (plural tables)', () => {
    it('selects the "one" category for count 1', () => {
      expect(i18n.t('nav.memoryStatsFacts', { count: 1 })).toBe('1 fact');
    });

    it('selects the "other" category for count 0', () => {
      expect(i18n.t('nav.memoryStatsFacts', { count: 0 })).toBe('0 facts');
    });

    it('selects the "other" category for count 2 and beyond', () => {
      expect(i18n.t('nav.memoryStatsFacts', { count: 2 })).toBe('2 facts');
      expect(i18n.t('nav.memoryStatsFacts', { count: 42 })).toBe('42 facts');
    });

    it('accepts a string count and still interpolates and selects correctly', () => {
      expect(i18n.t('nav.memoryStatsFacts', { count: '1' })).toBe('1 fact');
      expect(i18n.t('nav.memoryStatsFacts', { count: '5' })).toBe('5 facts');
    });

    it('selects the correct category in a locale with its own plural rules (Arabic)', async () => {
      await i18n.setLocale('ar');
      expect(i18n.t('chat.subAgentToolCount', { count: 0 })).toBe('لا أدوات');
      expect(i18n.t('chat.subAgentToolCount', { count: 1 })).toBe('أداة واحدة');
      expect(i18n.t('chat.subAgentToolCount', { count: 2 })).toBe('أداتان');
      expect(i18n.t('chat.subAgentToolCount', { count: 5 })).toBe('{count} أدوات'.replace('{count}', '5'));
      expect(i18n.t('chat.subAgentToolCount', { count: 100 })).toBe('{count} أداة'.replace('{count}', '100'));
    });

    it('falls back to the binary one/other rule when Intl.PluralRules is unavailable', () => {
      const OriginalPluralRules = Intl.PluralRules;
      // @ts-expect-error deliberately removing a constructor to test the guarded fallback
      delete (Intl as { PluralRules?: unknown }).PluralRules;
      try {
        expect(i18n.t('nav.memoryStatsFacts', { count: 1 })).toBe('1 fact');
        expect(i18n.t('nav.memoryStatsFacts', { count: 3 })).toBe('3 facts');
      } finally {
        (Intl as { PluralRules?: typeof Intl.PluralRules }).PluralRules = OriginalPluralRules;
      }
    });

    it('does not affect ordinary flat-string keys', () => {
      expect(i18n.t('common.ok')).toBe('OK');
    });

    it('missing count falls back to the "other" category', () => {
      expect(i18n.t('nav.memoryStatsFacts')).toBe('{count} facts');
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', async () => {
      const listener = jest.fn();
      const unsub = i18n.subscribe(listener);

      await i18n.setLocale('fr');
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      await i18n.setLocale('de');
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });

    it('supports multiple subscribers', async () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      i18n.subscribe(listener1);
      i18n.subscribe(listener2);

      await i18n.setLocale('ja');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });
});
