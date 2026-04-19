// ---------------------------------------------------------------------------
// Kavi — i18n Manager
// ---------------------------------------------------------------------------
// Singleton that manages the current locale and translation lookups.
// Uses a subscriber pattern so React components can re-render on locale change.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Locale, TranslationMap } from './types';
import { getEnglishTranslations, loadLocaleTranslations } from './registry';

const STORAGE_KEY = 'kavi_locale';

type Subscriber = () => void;

class I18nManager {
  private _locale: Locale = 'en';
  private _translations: TranslationMap = getEnglishTranslations();
  private _subscribers = new Set<Subscriber>();
  private _initialized = false;

  get locale(): Locale {
    return this._locale;
  }

  get translations(): TranslationMap {
    return this._translations;
  }

  /** Load persisted locale from AsyncStorage. Call once at app start. */
  async init(): Promise<void> {
    if (this._initialized) return;
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        await this.setLocale(stored as Locale);
      }
    } catch {
      // Fall back to 'en' silently
    }
    this._initialized = true;
  }

  /** Change the active locale. Loads translations lazily and persists the choice. */
  async setLocale(locale: Locale): Promise<void> {
    if (locale === this._locale && this._translations !== getEnglishTranslations()) return;
    this._locale = locale;
    this._translations = await loadLocaleTranslations(locale);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Best-effort persistence
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
