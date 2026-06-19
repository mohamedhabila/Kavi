import { useEffect, useState } from 'react';

import {
  formatLocalLlmRuntimeStatusLabel,
  getLocalLlmRuntimeStatus,
} from '../../services/localLlm/status';
import { isOnDeviceLlmProvider } from '../../services/localLlm/provider';
import { subscribeToLocalLlmRuntimeStatusChanges } from '../../services/localLlm/backendStatus';
import type { LocalLlmRuntimeStatus } from '../../services/localLlm/types';
import type { LlmProviderConfig } from '../../types/provider';

export function useSettingsLocalRuntimeStatuses(providers: LlmProviderConfig[]) {
  const [localRuntimeStatusesByProviderId, setLocalRuntimeStatusesByProviderId] = useState<
    Record<string, LocalLlmRuntimeStatus>
  >({});

  useEffect(() => {
    let cancelled = false;
    const loadStatuses = async () => {
      const onDeviceProviders = providers.filter((provider) => isOnDeviceLlmProvider(provider));

      if (onDeviceProviders.length === 0) {
        if (!cancelled) {
          setLocalRuntimeStatusesByProviderId({});
        }
        return;
      }

      try {
        const entries = await Promise.all(
          onDeviceProviders.map(async (provider) => {
            const status = await getLocalLlmRuntimeStatus(provider);
            return status ? ([provider.id, status] as const) : null;
          }),
        );

        if (cancelled) {
          return;
        }

        const nextStatuses: Record<string, LocalLlmRuntimeStatus> = {};
        entries.forEach((entry) => {
          if (!entry) {
            return;
          }
          nextStatuses[entry[0]] = entry[1];
        });
        setLocalRuntimeStatusesByProviderId(nextStatuses);
      } catch {
        if (!cancelled) {
          setLocalRuntimeStatusesByProviderId({});
        }
      }
    };

    void loadStatuses();
    const unsubscribe = subscribeToLocalLlmRuntimeStatusChanges(() => {
      void loadStatuses();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [providers]);

  return {
    localRuntimeStatusesByProviderId,
    formatLocalLlmRuntimeStatusLabel,
  };
}
