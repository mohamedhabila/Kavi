import type { LlmProviderConfig, LocalLlmAccelerator, LocalLlmRuntime } from '../../types/provider';
import {
  DEFAULT_LOCAL_LLM_ACCELERATOR,
  getDefaultLocalLlmAccelerator,
  getLocalLlmCatalogEntry,
} from './catalog';
import type { LocalLlmRuntimeStatus } from './types';

export function getLocalLlmRuntime(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
): LocalLlmRuntime {
  return getLocalLlmCatalogEntry(modelId)?.runtime || provider.local?.runtime || 'litert-lm';
}

export function resolveLocalLlmAccelerator(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
  deviceMemoryGb?: number | null,
): LocalLlmAccelerator {
  return resolveLocalLlmAcceleratorAnalysis(provider, modelId, deviceMemoryGb).backend;
}

export function resolveLocalLlmAuxiliaryAccelerator(
  activeAccelerator: LocalLlmAccelerator,
  defaultAccelerator: LocalLlmAccelerator | null | undefined,
): LocalLlmAccelerator | undefined {
  if (!defaultAccelerator) {
    return undefined;
  }
  return activeAccelerator === DEFAULT_LOCAL_LLM_ACCELERATOR
    ? DEFAULT_LOCAL_LLM_ACCELERATOR
    : defaultAccelerator;
}

export function resolveLocalLlmAcceleratorAnalysis(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
  _deviceMemoryGb?: number | null,
): {
  backend: LocalLlmAccelerator;
  reason: LocalLlmRuntimeStatus['resolvedBackendReason'];
} {
  const preferredBackend = getDefaultLocalLlmAccelerator(modelId);
  const configuredBackend = provider.local?.backend;
  const catalogEntry = getLocalLlmCatalogEntry(modelId);

  if (!configuredBackend) {
    return { backend: preferredBackend, reason: 'default' };
  }

  if (catalogEntry && !catalogEntry.supportedBackends.includes(configuredBackend)) {
    return { backend: preferredBackend, reason: 'default' };
  }

  return { backend: configuredBackend, reason: 'configured' };
}
