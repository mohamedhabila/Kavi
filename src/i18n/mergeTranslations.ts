import type { TranslationMap } from './types';

function isTranslationBranch(value: string | TranslationMap | undefined): value is TranslationMap {
  return typeof value === 'object' && value !== null;
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
