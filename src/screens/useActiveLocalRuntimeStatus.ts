import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getLocalLlmRuntimeStatus } from '../services/localLlm/status';
import { isOnDeviceLlmProvider } from '../services/localLlm/provider';
import { subscribeToLocalLlmRuntimeStatusChanges } from '../services/localLlm/backendStatus';
import type { LocalLlmRuntimeStatus } from '../services/localLlm/types';
import { LlmProviderConfig } from '../types/provider';

type UseActiveLocalRuntimeStatusParams = {
  activeProvider?: LlmProviderConfig;
  currentModel?: string;
  isFocused: boolean;
};

type ActiveLocalRuntimeStatusState = {
  activeLocalRuntimeStatus: LocalLlmRuntimeStatus | null;
  setActiveLocalRuntimeStatus: Dispatch<SetStateAction<LocalLlmRuntimeStatus | null>>;
};

export function useActiveLocalRuntimeStatus({
  activeProvider,
  currentModel,
  isFocused,
}: UseActiveLocalRuntimeStatusParams): ActiveLocalRuntimeStatusState {
  const [activeLocalRuntimeStatus, setActiveLocalRuntimeStatus] =
    useState<LocalLlmRuntimeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      if (
        !isFocused ||
        !activeProvider ||
        !currentModel ||
        !isOnDeviceLlmProvider(activeProvider)
      ) {
        if (!cancelled) {
          setActiveLocalRuntimeStatus(null);
        }
        return;
      }

      try {
        const status = await getLocalLlmRuntimeStatus(activeProvider, currentModel);
        if (!cancelled) {
          setActiveLocalRuntimeStatus(status);
        }
      } catch {
        if (!cancelled) {
          setActiveLocalRuntimeStatus(null);
        }
      }
    };

    if (!isFocused || !activeProvider || !currentModel || !isOnDeviceLlmProvider(activeProvider)) {
      setActiveLocalRuntimeStatus(null);
      return () => {
        cancelled = true;
      };
    }

    void loadStatus();
    const unsubscribe = subscribeToLocalLlmRuntimeStatusChanges(() => {
      void loadStatus();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isFocused, activeProvider, currentModel]);

  return { activeLocalRuntimeStatus, setActiveLocalRuntimeStatus };
}
