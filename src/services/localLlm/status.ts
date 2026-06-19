import type { LlmProviderConfig } from '../../types/provider';
import { getDefaultLocalLlmAccelerator } from './catalog';
import { getNativeLocalLlmAvailability } from './native';
import { getLocalLlmRuntimeActivity, getObservedLocalLlmBackend } from './backendStatus';
import { getLocalLlmRuntime, resolveLocalLlmAcceleratorAnalysis } from './backendPolicy';
import { isOnDeviceLlmProvider } from './provider';
import type { LocalLlmRuntimeStatus } from './types';

export async function getLocalLlmRuntimeStatus(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
): Promise<LocalLlmRuntimeStatus | null> {
  if (!isOnDeviceLlmProvider(provider)) {
    return null;
  }

  const nativeAvailability = await getNativeLocalLlmAvailability();
  const runtime = getLocalLlmRuntime(provider, modelId);
  const requestedBackend = provider.local?.backend || getDefaultLocalLlmAccelerator(modelId);
  const resolvedBackendAnalysis = resolveLocalLlmAcceleratorAnalysis(
    provider,
    modelId,
    nativeAvailability.deviceMemoryGb ?? null,
  );
  const resolvedBackend = resolvedBackendAnalysis.backend;
  const observedBackend = getObservedLocalLlmBackend(provider, modelId);
  const activity = getLocalLlmRuntimeActivity(provider, modelId);
  const activeBackend = observedBackend || resolvedBackend;

  return {
    runtime,
    requestedBackend,
    resolvedBackend,
    resolvedBackendReason: resolvedBackendAnalysis.reason,
    observedBackend,
    activeBackend,
    backendSource: observedBackend ? 'observed' : 'resolved',
    fellBackFromRequestedBackend: observedBackend != null && observedBackend !== requestedBackend,
    ...(activity ? { activity } : {}),
    ...(typeof nativeAvailability.runtimeMetrics?.backendFallbackCount === 'number'
      ? { backendFallbackCount: nativeAvailability.runtimeMetrics.backendFallbackCount }
      : {}),
    ...(nativeAvailability.supportedAccelerators
      ? { supportedAccelerators: nativeAvailability.supportedAccelerators }
      : {}),
    ...(nativeAvailability.accelerationFeatures
      ? { accelerationFeatures: nativeAvailability.accelerationFeatures }
      : {}),
  };
}

export function formatLocalLlmRuntimeStatusLabel(status: LocalLlmRuntimeStatus): string {
  const backendLabel = status.activeBackend.toUpperCase();

  if (status.backendSource === 'observed') {
    return status.fellBackFromRequestedBackend
      ? `Running on ${backendLabel} (${status.requestedBackend.toUpperCase()} fallback)`
      : `Running on ${backendLabel}`;
  }

  if (status.activeBackend === 'cpu') {
    if (status.resolvedBackendReason === 'configured') {
      return 'Likely CPU (configured)';
    }
  }

  return `Likely ${backendLabel}`;
}
