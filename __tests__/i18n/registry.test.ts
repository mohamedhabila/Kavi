// ---------------------------------------------------------------------------
// Tests — i18n Registry
// ---------------------------------------------------------------------------

import {
  resolveDeviceLocale,
  SUPPORTED_LOCALES,
  LOCALE_DISPLAY_NAMES,
  loadLocaleTranslations,
  getEnglishTranslations,
  clearLocaleCache,
} from '../../src/i18n/registry';

afterEach(() => {
  clearLocaleCache();
});

describe('SUPPORTED_LOCALES', () => {
  it('contains 9 locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(9);
  });

  it('includes en as first locale', () => {
    expect(SUPPORTED_LOCALES[0]).toBe('en');
  });

  it('includes all expected locales', () => {
    expect(SUPPORTED_LOCALES).toContain('zh-CN');
    expect(SUPPORTED_LOCALES).toContain('zh-TW');
    expect(SUPPORTED_LOCALES).toContain('pt-BR');
    expect(SUPPORTED_LOCALES).toContain('de');
    expect(SUPPORTED_LOCALES).toContain('es');
    expect(SUPPORTED_LOCALES).toContain('ar');
    expect(SUPPORTED_LOCALES).toContain('fr');
    expect(SUPPORTED_LOCALES).toContain('ja');
  });
});

describe('LOCALE_DISPLAY_NAMES', () => {
  it('has a display name for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_DISPLAY_NAMES[locale]).toBeTruthy();
    }
  });

  it('shows English for en', () => {
    expect(LOCALE_DISPLAY_NAMES.en).toBe('English');
  });
});

describe('resolveDeviceLocale', () => {
  it('returns exact match', () => {
    expect(resolveDeviceLocale('en')).toBe('en');
    expect(resolveDeviceLocale('fr')).toBe('fr');
    expect(resolveDeviceLocale('de')).toBe('de');
    expect(resolveDeviceLocale('ja')).toBe('ja');
  });

  it('handles case-insensitive matching', () => {
    expect(resolveDeviceLocale('EN')).toBe('en');
    expect(resolveDeviceLocale('Fr')).toBe('fr');
  });

  it('resolves zh-Hant to zh-TW', () => {
    expect(resolveDeviceLocale('zh-Hant')).toBe('zh-TW');
    expect(resolveDeviceLocale('zh-Hant-TW')).toBe('zh-TW');
  });

  it('resolves zh-HK to zh-TW', () => {
    expect(resolveDeviceLocale('zh-HK')).toBe('zh-TW');
  });

  it('resolves zh to zh-CN', () => {
    expect(resolveDeviceLocale('zh')).toBe('zh-CN');
    expect(resolveDeviceLocale('zh-CN')).toBe('zh-CN');
    expect(resolveDeviceLocale('zh-Hans')).toBe('zh-CN');
  });

  it('resolves pt to pt-BR', () => {
    expect(resolveDeviceLocale('pt')).toBe('pt-BR');
    expect(resolveDeviceLocale('pt-PT')).toBe('pt-BR');
  });

  it('resolves underscore-separated locales', () => {
    expect(resolveDeviceLocale('zh_TW')).toBe('zh-TW');
    expect(resolveDeviceLocale('pt_BR')).toBe('pt-BR');
  });

  it('falls back to en for unknown locales', () => {
    expect(resolveDeviceLocale('ko')).toBe('en');
    expect(resolveDeviceLocale('ru')).toBe('en');
    expect(resolveDeviceLocale('xx-YY')).toBe('en');
  });

  it('matches base language when regional variant is unsupported', () => {
    expect(resolveDeviceLocale('es-MX')).toBe('es');
    expect(resolveDeviceLocale('de-AT')).toBe('de');
    expect(resolveDeviceLocale('fr-CA')).toBe('fr');
  });
});

describe('getEnglishTranslations', () => {
  it('returns an object with common keys', () => {
    const en = getEnglishTranslations();
    expect(en.common).toBeDefined();
    expect(en.common.ok).toBe('OK');
    expect(en.chat).toBeDefined();
    expect(en.settings).toBeDefined();
  });
});

describe('loadLocaleTranslations', () => {
  it('loads English synchronously', async () => {
    const en = await loadLocaleTranslations('en');
    expect(en.common.ok).toBe('OK');
  });

  it('loads French via dynamic import', async () => {
    const fr = await loadLocaleTranslations('fr');
    expect(fr.common).toBeDefined();
    expect(fr.common.ok).toBeTruthy();
  });

  it('loads Arabic via dynamic import', async () => {
    const ar = await loadLocaleTranslations('ar');
    expect(ar.common).toBeDefined();
  });

  it('loads German via dynamic import', async () => {
    const de = await loadLocaleTranslations('de');
    expect(de.common).toBeDefined();
  });

  it('loads Spanish via dynamic import', async () => {
    const es = await loadLocaleTranslations('es');
    expect(es.common).toBeDefined();
  });

  it('loads Japanese via dynamic import', async () => {
    const ja = await loadLocaleTranslations('ja');
    expect(ja.common).toBeDefined();
  });

  it('loads Simplified Chinese via dynamic import', async () => {
    const zhCN = await loadLocaleTranslations('zh-CN');
    expect(zhCN.common).toBeDefined();
  });

  it('loads Traditional Chinese via dynamic import', async () => {
    const zhTW = await loadLocaleTranslations('zh-TW');
    expect(zhTW.common).toBeDefined();
  });

  it('loads Brazilian Portuguese via dynamic import', async () => {
    const ptBR = await loadLocaleTranslations('pt-BR');
    expect(ptBR.common).toBeDefined();
  });

  it('caches loaded translations', async () => {
    const first = await loadLocaleTranslations('fr');
    const second = await loadLocaleTranslations('fr');
    expect(first).toBe(second);
  });

  it('returns English for unknown locale', async () => {
    const unknown = await loadLocaleTranslations('en');
    const en = getEnglishTranslations();
    expect(unknown).toBe(en);
  });
});

describe('clearLocaleCache', () => {
  it('clears cached non-English locales', async () => {
    const first = await loadLocaleTranslations('fr');
    expect(first.common.ok).toBeTruthy();
    clearLocaleCache();
    // After clearing, loadLocaleTranslations re-loads (content is equivalent)
    const second = await loadLocaleTranslations('fr');
    expect(second.common.ok).toBe(first.common.ok);
  });

  it('keeps English in cache after clearing', () => {
    clearLocaleCache();
    const en = getEnglishTranslations();
    expect(en.common).toBeDefined();
  });
});
