// ---------------------------------------------------------------------------
// Tests — app.json declares the supported locales for expo-localization
// ---------------------------------------------------------------------------
// expo-localization's config plugin turns a `supportedLocales` plugin option
// into the native iOS `CFBundleLocalizations` Info.plist array (so the OS
// shows Kavi's own per-app language switcher and the App Store lists the
// supported languages) and the Android locale-config / resourceConfigurations
// equivalent, so this list is the single source of truth for both platforms.

import appJson from '../../app.json';
import { SUPPORTED_LOCALES } from '../../src/i18n/registry';
import { getLocaleBcp47Tag } from '../../src/i18n/localeBcp47';

function findLocalizationPluginConfig(): { supportedLocales?: string[] } | undefined {
  const plugins = appJson.expo.plugins as unknown[];
  for (const plugin of plugins) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-localization') {
      return plugin[1] as { supportedLocales?: string[] };
    }
  }
  return undefined;
}

describe('app.json localizations', () => {
  it('declares expo-localization with a supportedLocales option', () => {
    const config = findLocalizationPluginConfig();
    expect(config).toBeDefined();
    expect(Array.isArray(config?.supportedLocales)).toBe(true);
  });

  it('declares exactly the 9 supported locales, matching the TTS/DisplayNames tag mapping', () => {
    const config = findLocalizationPluginConfig();
    const declared = config?.supportedLocales ?? [];

    expect(declared).toHaveLength(9);
    expect(SUPPORTED_LOCALES).toHaveLength(9);

    const expectedTags = SUPPORTED_LOCALES.map((locale) => getLocaleBcp47Tag(locale));
    expect(new Set(declared)).toEqual(new Set(expectedTags));
  });

  it('every declared tag is a valid BCP-47 locale tag', () => {
    const config = findLocalizationPluginConfig();
    for (const tag of config?.supportedLocales ?? []) {
      expect(() => new Intl.Locale(tag)).not.toThrow();
    }
  });
});
