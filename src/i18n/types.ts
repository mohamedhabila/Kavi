// ---------------------------------------------------------------------------
// Kavi — i18n Types
// ---------------------------------------------------------------------------

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'pt-BR' | 'de' | 'es' | 'ar' | 'fr' | 'ja';

export interface I18nConfig {
  locale: Locale;
  fallbackLocale: Locale;
}

/** The six CLDR plural categories. `other` is the only one every language uses. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Every CLDR plural category, in CLDR's own canonical order. */
export const PLURAL_CATEGORIES: readonly PluralCategory[] = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
];

/**
 * A CLDR plural-form table for one translation key. `other` is required —
 * CLDR mandates it as the universal fallback category present in every
 * language's plural rule set — and every other property, if present, must
 * be one of the five remaining CLDR categories.
 */
export interface PluralTable {
  readonly other: string;
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
}

/**
 * Declares a plural table for a translation key, e.g.:
 *
 *   memoryStatsFacts: plural({ one: '{count} fact', other: '{count} facts' })
 *
 * This is the distinct type a plural-bearing key must use instead of a flat
 * string. Two things make it a real compile-time check rather than a
 * documentation convention:
 *
 * - `other` is required by `PluralTable` itself, so omitting it is a type
 *   error at the call site.
 * - The `Record<Exclude<keyof T, PluralCategory>, never>` intersection
 *   rejects any property that is not one of the six CLDR category names —
 *   a typo'd category (`otehr`) fails to compile instead of silently never
 *   being selected at runtime.
 *
 * A plain object literal typed as `TranslationMap` cannot get the same
 * guarantee: `TranslationMap`'s index signature accepts any string-keyed
 * object, so a `{ one: '...', two: '...' }` literal without `other` would
 * still structurally satisfy "nested translation namespace". Routing every
 * plural table through this function is what makes `other` actually
 * mandatory. Runtime authority for locale files (which cannot call
 * TypeScript functions from the raw AST the consistency checker parses)
 * still lives in `scripts/check-i18n-consistency.js` and in the manager's
 * `isPluralTable` guard.
 */
export function plural<T extends PluralTable & Record<Exclude<keyof T, PluralCategory>, never>>(
  table: T,
): PluralTable {
  return table;
}

/** A single translation leaf: either a flat string or a CLDR plural table. */
export type TranslationLeaf = string | PluralTable;

export type TranslationMap = { [key: string]: TranslationLeaf | TranslationMap };

/**
 * True when `value` is shaped like a `PluralTable`: a plain object whose
 * `other` property is a string and whose every own key is a CLDR plural
 * category. Used at runtime (locale files are plain JS objects by the time
 * the manager sees them — `plural()` is an identity function) to tell a
 * plural table apart from a nested translation namespace.
 */
export function isPluralTable(value: unknown): value is PluralTable {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.other !== 'string') return false;
  return Object.keys(record).every((key) =>
    (PLURAL_CATEGORIES as readonly string[]).includes(key),
  );
}
