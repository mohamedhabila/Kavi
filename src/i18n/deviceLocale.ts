// ---------------------------------------------------------------------------
// Kavi — Device Locale Detection
// ---------------------------------------------------------------------------
// Resolves the raw BCP-47 language tag the device is currently set to, so the
// i18n manager (and anything else that needs "what language is this device
// in") can map it onto a supported Kavi locale via `resolveDeviceLocale`.

/**
 * Best-effort BCP-47 language tag for the device's current locale.
 *
 * Prefers `expo-localization`'s `getLocales()[0].languageTag`, which reflects
 * the user's actual OS language preference. Falls back to the JS engine's
 * own `Intl` resolution, then to `'en'` if neither is available. Both native
 * accessors can throw in constrained environments (server-side rendering,
 * some simulator/preview states, or a JS engine without full ICU data), so
 * every step is guarded.
 */
export function getDeviceLocaleTag(): string {
  try {
    // Lazy require (rather than a static import) keeps this safe to call from
    // contexts where the native module isn't installed yet, since the throw
    // then happens inside this try block instead of at module load time.
    const Localization = require('expo-localization') as {
      getLocales: () => Array<{ languageTag?: string | null }>;
    };
    const tag = Localization.getLocales()?.[0]?.languageTag;
    if (typeof tag === 'string' && tag.trim().length > 0) {
      return tag.trim();
    }
  } catch {
    // expo-localization unavailable or getLocales() threw — fall through to Intl.
  }

  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
    if (typeof resolved === 'string' && resolved.trim().length > 0) {
      return resolved.trim();
    }
  } catch {
    // Intl unavailable in this JS engine — fall through to the hard default.
  }

  return 'en';
}
