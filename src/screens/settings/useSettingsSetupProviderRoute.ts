import { useEffect, useRef } from 'react';

import type { LlmProviderPreset } from '../../constants/api';
import { providerPresetFromRoute, setupRouteKey, type SetupRouteParams } from './setupRouteDraft';

/** Opens a new AI provider form, on the preset a setup guide named, once per request. */
export function useSettingsSetupProviderRoute(
  routeParams: SetupRouteParams | undefined,
  openNewProvider: (preset?: LlmProviderPreset) => void,
): void {
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = setupRouteKey(routeParams);
    if (routeParams?.section !== 'provider-edit' || !key || handledKeyRef.current === key) return;
    handledKeyRef.current = key;
    openNewProvider(providerPresetFromRoute(routeParams.setupDraft));
  }, [openNewProvider, routeParams]);
}
