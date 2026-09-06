// ---------------------------------------------------------------------------
// Kavi — CLDR Plural Category Resolution
// ---------------------------------------------------------------------------
// Resolves which CLDR plural category (`one`, `few`, `other`, ...) a count
// falls into for a given locale, so the i18n manager can pick the right
// form out of a `PluralTable`.
//
// Hermes — this project's JS engine on both platforms — does not implement
// `Intl.PluralRules` (see
// https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md), so the app
// installs the FormatJS `@formatjs/intl-pluralrules` polyfill (plus its
// `@formatjs/intl-getcanonicallocales` and `@formatjs/intl-locale`
// prerequisites) as the very first thing that runs, in
// `src/i18n/intlPolyfills.ts` — see that file for the full rationale and
// pinned versions. In normal operation `Intl.PluralRules` is therefore
// always present by the time this module is reached, on-device and in
// Jest alike, and resolves every supported locale's real CLDR rule
// (English's binary one/other, Arabic's six-way split, and everything in
// between).
//
// The lookup below stays guarded regardless: this project already hit an
// engine-support gap once before (`src/components/chat/temporalMarkers.ts`
// had to add a fallback because Hermes on Android does not ship
// `Intl.RelativeTimeFormat` — see git commit 4fdf9f42), and a defensive
// fallback here costs nothing. If the polyfill bootstrap were ever skipped
// or failed for an unforeseen reason, this still degrades to the universal
// binary rule rather than throwing.

import type { Locale, PluralCategory } from './types';
import { getLocaleBcp47Tag } from './localeBcp47';

/**
 * Resolve the CLDR plural category for `count` in `locale`.
 *
 * Prefers `Intl.PluralRules`, which encodes each language's actual CLDR
 * plural rules (English's binary one/other, Arabic's six-way split, and
 * everything in between) — present natively in Jest's Node runtime and,
 * on-device, via the polyfill bootstrap in `src/i18n/intlPolyfills.ts`.
 * If the constructor is ever missing or throws for a given locale tag,
 * falls back to the universal binary rule — `one` for exactly 1, `other`
 * for everything else (including non-integers and negative numbers) —
 * which is correct for English-shaped locales and an under-approximation
 * for richer ones (e.g. it cannot produce Arabic's `zero`/`two`/`few`/
 * `many`), but it always returns a valid category and never throws.
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
