// ---------------------------------------------------------------------------
// Kavi — Locale ↔ BCP-47 Mapping
// ---------------------------------------------------------------------------
// Kavi's `Locale` identifiers (registry.ts) are mostly BCP-47 already, but a
// few need a region suffix before they're safe to hand to platform APIs that
// expect a fully-qualified tag (text-to-speech engines in particular). This
// module is the single place that maps a `Locale` onto the tags those APIs
// need, and onto the endonym (the language's name written in itself) used to
// steer generated text toward the right language.

import { LOCALE_DISPLAY_NAMES } from './registry';
import type { Locale } from './types';

/**
 * Fully-qualified BCP-47 tag per supported locale, suitable for
 * platform text-to-speech engines (e.g. `expo-speech`) which require a
 * region-qualified tag rather than a bare language code.
 */
export const LOCALE_BCP47_TAGS: Record<Locale, string> = {
  en: 'en-US',
  ar: 'ar',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  ja: 'ja-JP',
  'pt-BR': 'pt-BR',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
};

/**
 * `Intl.DisplayNames` language-lookup code per locale. Unlike the TTS tags
 * above, these deliberately omit region qualifiers (which make
 * `Intl.DisplayNames` append a parenthetical region, e.g. "français
 * (France)") and use the `Hans`/`Hant` script subtags for the two Chinese
 * variants so the two are named distinctly ("简体中文" / "繁體中文") instead
 * of both collapsing to a generic "中文".
 */
const LOCALE_DISPLAY_NAME_CODES: Record<Locale, string> = {
  en: 'en',
  ar: 'ar',
  de: 'de',
  es: 'es',
  fr: 'fr',
  ja: 'ja',
  'pt-BR': 'pt',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
};

/** Fully-qualified BCP-47 tag for `locale`, for platform APIs that require one. */
export function getLocaleBcp47Tag(locale: Locale): string {
  return LOCALE_BCP47_TAGS[locale] ?? LOCALE_BCP47_TAGS.en;
}

/**
 * The name of `locale`'s language, written in that language itself (its
 * endonym) — e.g. "français" for `fr`, "日本語" for `ja`. Used to instruct a
 * model to reply in a specific language regardless of what language the
 * instruction itself is written in.
 *
 * Uses `Intl.DisplayNames` where available, falling back to the static
 * `LOCALE_DISPLAY_NAMES` registry (which is guaranteed to cover every
 * supported locale) if that API is missing or throws in the current JS
 * engine.
 */
export function getLocaleLanguageName(locale: Locale): string {
  try {
    const tag = getLocaleBcp47Tag(locale);
    const code = LOCALE_DISPLAY_NAME_CODES[locale] ?? locale;
    const displayNames = new Intl.DisplayNames([tag], { type: 'language' });
    const name = displayNames.of(code);
    if (typeof name === 'string' && name.trim().length > 0) {
      return name;
    }
  } catch {
    // Intl.DisplayNames unsupported (or missing ICU data) in this JS engine.
  }

  return LOCALE_DISPLAY_NAMES[locale] ?? LOCALE_DISPLAY_NAMES.en;
}
