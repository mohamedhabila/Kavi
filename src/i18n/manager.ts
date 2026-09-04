// ---------------------------------------------------------------------------
// Kavi — i18n Manager
// ---------------------------------------------------------------------------
// Singleton that manages the current locale and translation lookups.
// Uses a subscriber pattern so React components can re-render on locale change.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Locale, TranslationMap } from './types';
import { getEnglishTranslations, loadLocaleTranslations, SUPPORTED_LOCALES, resolveDeviceLocale } from './registry';
import { getDeviceLocaleTag } from './deviceLocale';

const STORAGE_KEY = 'kavi_locale';

/** Sentinel persisted value meaning "track the device's language automatically". */
export const SYSTEM_LOCALE_PREFERENCE = 'system' as const;

/**
 * What the user has asked for: either a specific supported locale, or the
 * `'system'` sentinel meaning "keep following the device's language".
 */
export type LocalePreference = Locale | typeof SYSTEM_LOCALE_PREFERENCE;

type Subscriber = () => void;

function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Resolve a locale preference down to the concrete locale it should render. */
function resolveEffectiveLocale(preference: LocalePreference): Locale {
  return preference === SYSTEM_LOCALE_PREFERENCE
    ? resolveDeviceLocale(getDeviceLocaleTag())
    : preference;
}

class I18nManager {
  private _locale: Locale = 'en';
  private _localePreference: LocalePreference = SYSTEM_LOCALE_PREFERENCE;
  private _translations: TranslationMap = getEnglishTranslations();
  private _subscribers = new Set<Subscriber>();
  private _initialized = false;

  get locale(): Locale {
    return this._locale;
  }

  /** The user's stated preference: a specific locale, or `'system'`. */
  get localePreference(): LocalePreference {
    return this._localePreference;
  }

  get translations(): TranslationMap {
    return this._translations;
  }

  /**
   * Load the persisted locale preference from AsyncStorage. Call once at app start.
   *
   * - A stored explicit locale (from before "follow system" existed, or a
   *   deliberate later choice) is kept as-is — switching it out from under an
   *   existing install would be a surprise, not a fix.
   * - A stored `'system'` value, or nothing stored at all (a fresh install,
   *   or an existing install that never opened the language picker), follows
   *   the device's language and keeps doing so on every future `init()`.
   * - An unrecognized stored value (corrupted storage, or a locale later
   *   dropped from `SUPPORTED_LOCALES`) is treated the same as "nothing
   *   stored" and recovers by following the device.
   */
  async init(): Promise<void> {
    if (this._initialized) return;
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && isSupportedLocale(stored)) {
        await this._applyLocalePreference(stored, false);
      } else if (stored === SYSTEM_LOCALE_PREFERENCE) {
        await this._applyLocalePreference(SYSTEM_LOCALE_PREFERENCE, false);
      } else {
        // Nothing stored, or an unrecognized value: default to following the
        // device locale, and persist that choice so it's explicit from here on.
        await this._applyLocalePreference(SYSTEM_LOCALE_PREFERENCE, true);
      }
    } catch {
      // Fall back to the constructor defaults ('system' → resolved on next call) silently.
    }
    this._initialized = true;
  }

  /** Pin the active locale to an explicit choice. Loads translations lazily and persists it. */
  async setLocale(locale: Locale): Promise<void> {
    await this._applyLocalePreference(locale, true);
  }

  /**
   * Set the locale preference, which may be an explicit locale or the
   * `'system'` sentinel to follow the device's language going forward.
   */
  async setLocalePreference(preference: LocalePreference): Promise<void> {
    await this._applyLocalePreference(preference, true);
  }

  private async _applyLocalePreference(preference: LocalePreference, persist: boolean): Promise<void> {
    const resolvedLocale = resolveEffectiveLocale(preference);
    const unchanged =
      preference === this._localePreference &&
      resolvedLocale === this._locale &&
      this._translations !== getEnglishTranslations();
    if (unchanged) return;

    this._localePreference = preference;
    this._locale = resolvedLocale;
    this._translations = await loadLocaleTranslations(resolvedLocale);

    if (persist) {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, preference);
      } catch {
        // Best-effort persistence
      }
    }

    this._notify();
  }

  /**
   * Translate a dot-delimited key. Supports `{param}` interpolation.
   *
   * @example
   *   t('chat.toolCall', { name: 'web_fetch' })
   *   // → "Using tool: web_fetch"
   */
  t(key: string, params?: Record<string, string | number>): string {
    let value = this._resolve(this._translations, key);

    // Fallback to English when key is missing in current locale
    if (value === undefined) {
      value = this._resolve(getEnglishTranslations(), key);
    }

    if (value === undefined) return key; // Last resort: return the key itself

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }

    return value;
  }

  subscribe(fn: Subscriber): () => void {
    this._subscribers.add(fn);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  private _notify(): void {
    for (const fn of this._subscribers) fn();
  }

  private _resolve(map: TranslationMap, key: string): string | undefined {
    const parts = key.split('.');
    let current: TranslationMap | string = map;
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return undefined;
      current = (current as Record<string, TranslationMap | string>)[part];
      if (current === undefined) return undefined;
    }
    return typeof current === 'string' ? current : undefined;
  }
}

/** Global singleton */
export const i18n = new I18nManager();
