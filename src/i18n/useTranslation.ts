// ---------------------------------------------------------------------------
// Kavi — useTranslation React Hook
// ---------------------------------------------------------------------------

import { useCallback, useSyncExternalStore } from 'react';
import { i18n } from './manager';
import type { Locale } from './types';

/**
 * React hook that provides translation helpers and re-renders on locale change.
 *
 * @example
 *   const { t, locale, setLocale } = useTranslation();
 *   return <Text>{t('chat.title')}</Text>;
 */
export function useTranslation() {
  // Subscribe to i18n manager changes for automatic re-render
  const subscribe = useCallback((onStoreChange: () => void) => i18n.subscribe(onStoreChange), []);

  const getSnapshot = useCallback(() => i18n.locale, []);

  const locale = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => i18n.t(key, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale], // re-create t when locale changes so memo consumers re-render
  );

  const setLocale = useCallback(async (l: Locale) => {
    await i18n.setLocale(l);
  }, []);

  return { t, locale, setLocale } as const;
}
