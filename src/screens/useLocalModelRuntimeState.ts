import { LlmProviderConfig } from '../types/provider';
import type { LocalLlmRuntimeStatus } from '../services/localLlm/types';
import { useActiveLocalRuntimeStatus } from './useActiveLocalRuntimeStatus';

type UseLocalModelRuntimeStateParams = {
  activeProvider?: LlmProviderConfig;
  currentModel?: string;
  chatError: string | null;
  isFocused: boolean;
};

export function useLocalModelRuntimeState({
  activeProvider,
  currentModel,
  chatError,
  isFocused,
}: UseLocalModelRuntimeStateParams): {
  activeLocalRuntimeStatus: LocalLlmRuntimeStatus | null;
  activeErrorMessage: string | null;
} {
  const { activeLocalRuntimeStatus } = useActiveLocalRuntimeStatus({
    activeProvider,
    currentModel,
    isFocused,
  });

  return {
    activeLocalRuntimeStatus,
    activeErrorMessage: chatError,
  };
}
