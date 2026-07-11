import type { LlmProviderConfig, LocalLlmAccelerator, LocalLlmRuntime } from '../../types/provider';
import { ensureLocalLlmModelCanRun } from './availability';
import { getObservedLocalLlmBackend } from './backendStatus';
import {
  getLocalLlmRuntime,
  resolveLocalLlmAccelerator,
  resolveLocalLlmAuxiliaryAccelerator,
} from './backendPolicy';
import { getLocalLlmExecutionPolicy } from './executionPolicy';
import { getNativeLocalLlmModelPath, resolveInstalledLocalLlmModelPath } from './modelArtifacts';
import { applyLocalLlmRequestOverrides } from './requestOverrides';
import type { LocalLlmExecutionPolicy, LocalLlmRequestOptions } from './types';

export type PreparedLocalLlmRequest = {
  backend: LocalLlmAccelerator;
  conversationKey?: string;
  executionPolicy: LocalLlmExecutionPolicy;
  modelPath: string;
  nativeModelPath: string;
  runtime: LocalLlmRuntime;
  visionBackend?: LocalLlmAccelerator;
  audioBackend?: LocalLlmAccelerator;
};

function localLlmPreparationAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  return error;
}

async function awaitLocalLlmPreparation<T>(
  startOperation: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return startOperation();
  if (signal.aborted) throw localLlmPreparationAbortError(signal);
  const operation = startOperation();
  let rejectAbort: ((error: Error) => void) | null = null;
  const abort = () => rejectAbort?.(localLlmPreparationAbortError(signal));
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
        if (signal.aborted) reject(localLlmPreparationAbortError(signal));
      }),
    ]);
  } finally {
    rejectAbort = null;
    signal.removeEventListener('abort', abort);
  }
}

export async function prepareLocalLlmRequest(
  provider: LlmProviderConfig,
  options?: LocalLlmRequestOptions,
): Promise<PreparedLocalLlmRequest> {
  const availability = await awaitLocalLlmPreparation(
    () => ensureLocalLlmModelCanRun(provider.model),
    options?.signal,
  );
  const resolvedBackend = resolveLocalLlmAccelerator(
    provider,
    provider.model,
    availability.deviceMemoryGb ?? null,
  );
  const observedBackend =
    resolvedBackend === 'cpu' ? null : getObservedLocalLlmBackend(provider, provider.model);
  const backend = observedBackend || resolvedBackend;
  const executionPolicy = applyLocalLlmRequestOverrides(
    getLocalLlmExecutionPolicy(provider.model, {
      backend,
      deviceMemoryGb: availability.deviceMemoryGb ?? null,
      observedBackend,
      lowMemoryDevice: availability.lowMemoryDevice ?? null,
    }),
    options,
  );

  const modelPath = resolveInstalledLocalLlmModelPath(provider, provider.model);
  if (!modelPath) {
    throw new Error(
      `Model ${provider.model} is missing or invalid on this device. Download it again before using on-device inference.`,
    );
  }

  return {
    backend,
    conversationKey: options?.conversationId?.trim() || undefined,
    executionPolicy,
    modelPath,
    nativeModelPath: getNativeLocalLlmModelPath(modelPath),
    runtime: getLocalLlmRuntime(provider, provider.model),
    visionBackend: resolveLocalLlmAuxiliaryAccelerator(
      backend,
      executionPolicy.defaultVisionAccelerator,
    ),
    audioBackend: resolveLocalLlmAuxiliaryAccelerator(
      backend,
      executionPolicy.defaultAudioAccelerator,
    ),
  };
}
