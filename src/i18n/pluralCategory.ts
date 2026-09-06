// ---------------------------------------------------------------------------
// Kavi — CLDR Plural Category Resolution
// ---------------------------------------------------------------------------
// Resolves which CLDR plural category (`one`, `few`, `other`, ...) a count
// falls into for a given locale, so the i18n manager can pick the right
// form out of a `PluralTable`.
//
// Hermes is compiled with Intl support on both platforms this project ships
// to — see `-DHERMES_ENABLE_INTL=True` in
// node_modules/react-native/ReactAndroid/hermes-engine/build.gradle.kts and
// the matching flag in
// node_modules/react-native/sdks/hermes-engine/utils/build-apple-framework.sh
// — but that flag turns on Hermes's own hand-written Intl subset, not full
// ICU, and it does not imply every Intl constructor is present. This
// project already hit that gap once: `src/components/chat/temporalMarkers.ts`
// had to add a guard because Hermes on Android does not ship
// `Intl.RelativeTimeFormat` even with Intl enabled (see git commit
// 4fdf9f42, "fix(chat): survive a JavaScript engine without
// Intl.RelativeTimeFormat"). `Intl.PluralRules` is a more foundational,
// longer-standing API than `RelativeTimeFormat`, but nothing here assumes
// it is present — every call is guarded, with a fallback that can never
// throw or return a category outside the CLDR set.

import type { Locale, PluralCategory } from './types';
import { getLocaleBcp47Tag } from './localeBcp47';

/**
 * Resolve the CLDR plural category for `count` in `locale`.
 *
 * Prefers `Intl.PluralRules`, which encodes each language's actual CLDR
 * plural rules (English's binary one/other, Arabic's six-way split, and
 * everything in between). When the constructor is missing or throws for
 * this locale tag, falls back to the universal binary rule — `one` for
 * exactly 1, `other` for everything else (including non-integers and
 * negative numbers) — which is correct for English-shaped locales and an
 * under-approximation for richer ones (e.g. it cannot produce Arabic's
 * `zero`/`two`/`few`/`many`), but it always returns a valid category and
 * never throws.
 */
export function selectPluralCategory(locale: Locale, count: number | undefined): PluralCategory {
  if (count === undefined || Number.isNaN(count)) return 'other';

  const PluralRulesCtor = (Intl as { PluralRules?: typeof Intl.PluralRules }).PluralRules;
  if (typeof PluralRulesCtor === 'function') {
    try {
      const tag = getLocaleBcp47Tag(locale);
      return new PluralRulesCtor(tag).select(count) as PluralCategory;
    } catch {
      // Constructor present but unusable for this tag (missing CLDR data
      // for it in this engine) — fall through to the manual rule below.
    }
  }

  return count === 1 ? 'one' : 'other';
}
