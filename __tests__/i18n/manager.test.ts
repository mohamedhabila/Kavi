// ---------------------------------------------------------------------------
// Tests — i18n Manager
// ---------------------------------------------------------------------------

import { clearLocaleCache } from '../../src/i18n/registry';

// We need a fresh manager for each test, so we use dynamic import and jest.resetModules
let i18n: (typeof import('../../src/i18n/manager'))['i18n'];
let AsyncStorage: { getItem: jest.Mock; setItem: jest.Mock };

beforeEach(() => {
  jest.resetModules();
  clearLocaleCache();

  // Re-import mocks and module AFTER resetModules so they share the same instance
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
  AsyncStorage.getItem.mockReset().mockResolvedValue(null);
  AsyncStorage.setItem.mockReset().mockResolvedValue(undefined);

  const mod = require('../../src/i18n/manager');
  i18n = mod.i18n;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('I18nManager', () => {
  describe('init', () => {
    it('defaults to English locale', () => {
      expect(i18n.locale).toBe('en');
    });

    it('loads persisted locale from AsyncStorage', async () => {
      AsyncStorage.getItem.mockResolvedValue('fr');
      await i18n.init();
      expect(i18n.locale).toBe('fr');
    });

    it('stays en if AsyncStorage has no value', async () => {
      await i18n.init();
      expect(i18n.locale).toBe('en');
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
    it('changes the locale', async () => {
      await i18n.setLocale('fr');
      expect(i18n.locale).toBe('fr');
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
