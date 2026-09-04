// ---------------------------------------------------------------------------
// Tests — Locale ↔ BCP-47 Mapping
// ---------------------------------------------------------------------------

import { getLocaleBcp47Tag, getLocaleLanguageName } from '../../src/i18n/localeBcp47';
import { SUPPORTED_LOCALES } from '../../src/i18n/registry';

describe('getLocaleBcp47Tag', () => {
  it('maps every supported locale to a fully-qualified BCP-47 tag', () => {
    expect(getLocaleBcp47Tag('en')).toBe('en-US');
    expect(getLocaleBcp47Tag('ar')).toBe('ar');
    expect(getLocaleBcp47Tag('de')).toBe('de-DE');
    expect(getLocaleBcp47Tag('es')).toBe('es-ES');
    expect(getLocaleBcp47Tag('fr')).toBe('fr-FR');
    expect(getLocaleBcp47Tag('ja')).toBe('ja-JP');
    expect(getLocaleBcp47Tag('pt-BR')).toBe('pt-BR');
    expect(getLocaleBcp47Tag('zh-CN')).toBe('zh-CN');
    expect(getLocaleBcp47Tag('zh-TW')).toBe('zh-TW');
  });

  it('covers every locale in SUPPORTED_LOCALES', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(typeof getLocaleBcp47Tag(locale)).toBe('string');
      expect(getLocaleBcp47Tag(locale).length).toBeGreaterThan(0);
    }
  });
});

describe('getLocaleLanguageName', () => {
  it('names each language in itself (endonym)', () => {
    expect(getLocaleLanguageName('en')).toBe('English');
    expect(getLocaleLanguageName('fr')).toBe('français');
    expect(getLocaleLanguageName('ja')).toBe('日本語');
    expect(getLocaleLanguageName('ar')).toBe('العربية');
  });

  it('distinguishes simplified and traditional Chinese', () => {
    const simplified = getLocaleLanguageName('zh-CN');
    const traditional = getLocaleLanguageName('zh-TW');
    expect(simplified).not.toBe(traditional);
    expect(simplified).toContain('简体');
    expect(traditional).toContain('繁體');
  });

  it('falls back to the static registry when Intl.DisplayNames throws', () => {
    const originalDisplayNames = Intl.DisplayNames;
    // @ts-expect-error — deliberately breaking Intl.DisplayNames for this test
    Intl.DisplayNames = class {
      constructor() {
        throw new Error('Intl.DisplayNames unsupported');
      }
    };

    try {
      expect(getLocaleLanguageName('de')).toBe('Deutsch');
    } finally {
      Intl.DisplayNames = originalDisplayNames;
    }
  });

  it('covers every locale in SUPPORTED_LOCALES without throwing', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getLocaleLanguageName(locale).length).toBeGreaterThan(0);
    }
  });
});
