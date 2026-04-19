// ---------------------------------------------------------------------------
// Kavi — i18n Locale Registry
// ---------------------------------------------------------------------------

import type { Locale, TranslationMap } from './types';
import { en } from './locales/en';

export const SUPPORTED_LOCALES: readonly Locale[] = [
  'en',
  'zh-CN',
  'zh-TW',
  'pt-BR',
  'de',
  'es',
  'ar',
  'fr',
  'ja',
] as const;

/** Locale display names (in their own language) */
export const LOCALE_DISPLAY_NAMES: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'pt-BR': 'Português',
  de: 'Deutsch',
  es: 'Español',
  ar: 'العربية',
  fr: 'Français',
  ja: '日本語',
};

const localeCache = new Map<Locale, TranslationMap>();
localeCache.set('en', en); // English is always loaded

function mergeTranslations(base: TranslationMap, override: TranslationMap): TranslationMap {
  const merged: TranslationMap = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (
      typeof baseValue === 'object' &&
      baseValue !== null &&
      typeof value === 'object' &&
      value !== null
    ) {
      merged[key] = mergeTranslations(baseValue as TranslationMap, value as TranslationMap);
      continue;
    }
    merged[key] = value as string | TranslationMap;
  }

  return merged;
}

/**
 * Resolve a BCP-47 language tag (e.g. from device) to a supported locale.
 * Falls back to 'en' when nothing better matches.
 */
export function resolveDeviceLocale(bcp47: string): Locale {
  const lower = bcp47.toLowerCase().replace('_', '-');

  // Exact match
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;

  // Regional fallbacks
  if (lower.startsWith('zh-hant') || lower.startsWith('zh-tw') || lower.startsWith('zh-hk'))
    return 'zh-TW';
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('pt')) return 'pt-BR';

  // Base language match
  const base = lower.split('-')[0];
  const match = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(base));
  if (match) return match;

  return 'en';
}

/**
 * Lazily load a locale translation map. English is always synchronous.
 * Other locales use dynamic import so they don't bloat the initial bundle.
 */
export async function loadLocaleTranslations(locale: Locale): Promise<TranslationMap> {
  const cached = localeCache.get(locale);
  if (cached) return cached;

  let translations: TranslationMap;

  switch (locale) {
    case 'ar': {
      const mod = require('./locales/ar');
      translations = mod.ar;
      break;
    }
    case 'de': {
      const mod = require('./locales/de');
      translations = mod.de;
      break;
    }
    case 'es': {
      const mod = require('./locales/es');
      translations = mod.es;
      break;
    }
    case 'fr': {
      const mod = require('./locales/fr');
      translations = mod.fr;
      break;
    }
    case 'ja': {
      const mod = require('./locales/ja');
      translations = mod.ja;
      break;
    }
    case 'pt-BR': {
      const mod = require('./locales/pt-BR');
      translations = mod.ptBR;
      break;
    }
    case 'zh-CN': {
      const mod = require('./locales/zh-CN');
      translations = mod.zhCN;
      break;
    }
    case 'zh-TW': {
      const mod = require('./locales/zh-TW');
      translations = mod.zhTW;
      break;
    }
    default:
      translations = en;
  }

  const merged = mergeTranslations(en, translations);
  localeCache.set(locale, merged);
  return merged;
}

/** Pre-loaded English translations (always available synchronously). */
export function getEnglishTranslations(): TranslationMap {
  return en;
}

/** Clear the locale cache (useful for tests). */
export function clearLocaleCache(): void {
  localeCache.clear();
  localeCache.set('en', en);
}
