import type { LlmProviderConfig, LocalLlmAccelerator } from '../../types/provider';
import type { LocalLlmRuntimeActivity, LocalLlmRuntimeStatusListener } from './types';
import { getNativeLocalLlmModelPath, resolveInstalledLocalLlmModelPath } from './modelArtifacts';

const OBSERVED_LOCAL_LLM_BACKENDS = new Map<string, LocalLlmAccelerator>();
const LOCAL_LLM_RUNTIME_ACTIVITIES = new Map<string, LocalLlmRuntimeActivity>();
const LOCAL_LLM_RUNTIME_STATUS_LISTENERS = new Set<LocalLlmRuntimeStatusListener>();

function notifyLocalLlmRuntimeStatusListeners(): void {
  LOCAL_LLM_RUNTIME_STATUS_LISTENERS.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore listener failures to keep runtime observation side-effect free.
    }
  });
}

export function subscribeToLocalLlmRuntimeStatusChanges(
  listener: LocalLlmRuntimeStatusListener,
): () => void {
  LOCAL_LLM_RUNTIME_STATUS_LISTENERS.add(listener);
  return () => {
    LOCAL_LLM_RUNTIME_STATUS_LISTENERS.delete(listener);
  };
}

function normalizeObservedLocalLlmBackendKey(modelPath: string): string {
  return getNativeLocalLlmModelPath(modelPath).trim();
}

export function rememberObservedLocalLlmBackend(
  modelPath: string,
  backend?: LocalLlmAccelerator | null,
): void {
  if (!backend) {
    return;
  }
  const normalizedKey = normalizeObservedLocalLlmBackendKey(modelPath);
  const previousBackend = OBSERVED_LOCAL_LLM_BACKENDS.get(normalizedKey);
  if (previousBackend === backend) {
    return;
  }

  OBSERVED_LOCAL_LLM_BACKENDS.set(normalizedKey, backend);
  notifyLocalLlmRuntimeStatusListeners();
}

export function getObservedLocalLlmBackend(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
): LocalLlmAccelerator | null {
  const modelPath = resolveInstalledLocalLlmModelPath(provider as LlmProviderConfig, modelId);
  if (!modelPath) {
    return null;
  }

  return OBSERVED_LOCAL_LLM_BACKENDS.get(normalizeObservedLocalLlmBackendKey(modelPath)) ?? null;
}

export function rememberLocalLlmRuntimeActivity(
  modelPath: string,
  activity: LocalLlmRuntimeActivity,
): void {
  const normalizedKey = normalizeObservedLocalLlmBackendKey(modelPath);
  const previousActivity = LOCAL_LLM_RUNTIME_ACTIVITIES.get(normalizedKey);
  if (previousActivity === activity) {
    return;
  }

  LOCAL_LLM_RUNTIME_ACTIVITIES.set(normalizedKey, activity);
  notifyLocalLlmRuntimeStatusListeners();
}

export function clearLocalLlmRuntimeActivity(
  modelPath: string,
  activity?: LocalLlmRuntimeActivity,
): void {
  const normalizedKey = normalizeObservedLocalLlmBackendKey(modelPath);
  if (activity && LOCAL_LLM_RUNTIME_ACTIVITIES.get(normalizedKey) !== activity) {
    return;
  }

  if (LOCAL_LLM_RUNTIME_ACTIVITIES.delete(normalizedKey)) {
    notifyLocalLlmRuntimeStatusListeners();
  }
}

export function getLocalLlmRuntimeActivity(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
): LocalLlmRuntimeActivity | null {
  const modelPath = resolveInstalledLocalLlmModelPath(provider as LlmProviderConfig, modelId);
  if (!modelPath) {
    return null;
  }

  return LOCAL_LLM_RUNTIME_ACTIVITIES.get(normalizeObservedLocalLlmBackendKey(modelPath)) ?? null;
}

export function clearObservedLocalLlmBackends(): void {
  if (OBSERVED_LOCAL_LLM_BACKENDS.size === 0 && LOCAL_LLM_RUNTIME_ACTIVITIES.size === 0) {
    return;
  }

  OBSERVED_LOCAL_LLM_BACKENDS.clear();
  LOCAL_LLM_RUNTIME_ACTIVITIES.clear();
  notifyLocalLlmRuntimeStatusListeners();
}
