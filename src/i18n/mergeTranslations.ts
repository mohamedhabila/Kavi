import type { TranslationMap, TranslationLeaf } from './types';
import { isPluralTable } from './types';

/**
 * True for a nested translation namespace, false for a leaf value — a flat
 * string, or a `PluralTable` (which is a plain object but must be replaced
 * as a whole, not deep-merged category by category: a locale's plural
 * table missing a category should surface as a gap in
 * `check-i18n-consistency.js`, not silently inherit that category's text
 * from the base locale).
 */
function isTranslationBranch(value: TranslationLeaf | TranslationMap | undefined): value is TranslationMap {
  return typeof value === 'object' && value !== null && !isPluralTable(value);
}

export function mergeTranslations(base: TranslationMap, overrides: TranslationMap): TranslationMap {
  const merged: TranslationMap = { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = merged[key];
    if (isTranslationBranch(baseValue) && isTranslationBranch(value)) {
      merged[key] = mergeTranslations(baseValue, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}
