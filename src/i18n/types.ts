// ---------------------------------------------------------------------------
// Kavi — i18n Types
// ---------------------------------------------------------------------------

export type TranslationMap = { [key: string]: string | TranslationMap };

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'pt-BR' | 'de' | 'es' | 'ar' | 'fr' | 'ja';

export interface I18nConfig {
  locale: Locale;
  fallbackLocale: Locale;
}
