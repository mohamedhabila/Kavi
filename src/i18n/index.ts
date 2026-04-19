// ---------------------------------------------------------------------------
// Kavi — i18n Public API
// ---------------------------------------------------------------------------

export { i18n } from './manager';
export { useTranslation } from './useTranslation';
export {
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  resolveDeviceLocale,
  loadLocaleTranslations,
  clearLocaleCache,
} from './registry';
export type { Locale, TranslationMap, I18nConfig } from './types';
