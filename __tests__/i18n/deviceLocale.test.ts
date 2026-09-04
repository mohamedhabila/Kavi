// ---------------------------------------------------------------------------
// Tests — Device Locale Detection
// ---------------------------------------------------------------------------

describe('getDeviceLocaleTag', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('returns the device languageTag from expo-localization', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: jest.fn(() => [{ languageTag: 'pt-BR' }]),
    }));
    const { getDeviceLocaleTag } = require('../../src/i18n/deviceLocale');
    expect(getDeviceLocaleTag()).toBe('pt-BR');
  });

  it('falls back to Intl when expo-localization throws', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: jest.fn(() => {
        throw new Error('native module unavailable');
      }),
    }));
    const intlSpy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockReturnValue({ resolvedOptions: () => ({ locale: 'de-DE' }) } as any);

    const { getDeviceLocaleTag } = require('../../src/i18n/deviceLocale');
    expect(getDeviceLocaleTag()).toBe('de-DE');
    intlSpy.mockRestore();
  });

  it('falls back to Intl when expo-localization returns no languageTag', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: jest.fn(() => [{ languageTag: null }]),
    }));
    const intlSpy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockReturnValue({ resolvedOptions: () => ({ locale: 'ja-JP' }) } as any);

    const { getDeviceLocaleTag } = require('../../src/i18n/deviceLocale');
    expect(getDeviceLocaleTag()).toBe('ja-JP');
    intlSpy.mockRestore();
  });

  it('falls back to "en" when both expo-localization and Intl are unavailable', () => {
    jest.doMock('expo-localization', () => ({
      getLocales: jest.fn(() => {
        throw new Error('native module unavailable');
      }),
    }));
    const intlSpy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('Intl unavailable');
    });

    const { getDeviceLocaleTag } = require('../../src/i18n/deviceLocale');
    expect(getDeviceLocaleTag()).toBe('en');
    intlSpy.mockRestore();
  });
});
