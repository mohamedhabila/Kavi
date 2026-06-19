import type { LocalLlmModelCatalogEntry } from '../../types/provider';
import {
  getCurrentLocalLlmPlatform,
  getLocalLlmCatalogEntry,
  getSupportedLocalLlmCatalogEntries,
} from './catalog';
import {
  LOCAL_LLM_MEMORY_EPSILON_GB,
  LOCAL_LLM_MEMORY_HARD_BLOCK_RATIO,
  LOCAL_LLM_NEAR_MINIMUM_MEMORY_HEADROOM_GB,
} from './constants';
import { formatLocalLlmPlatform } from './platformPolicy';
import type { LocalLlmExecutionPolicy } from './types';

export function formatLocalLlmMemoryGb(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function buildUnsupportedLocalLlmPlatformReason(modelId: string): string {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    return `Unknown local model: ${modelId}.`;
  }

  const platformList = catalogEntry.supportedPlatforms.map(formatLocalLlmPlatform).join(' or ');
  return `${catalogEntry.name} is only supported on ${platformList}.`;
}

export function getLocalLlmMemoryRequirementStatus(
  minDeviceMemoryGb: number,
  deviceMemoryGb: number,
): 'ok' | 'warn' | 'block' {
  const hardBlockFloorGb = minDeviceMemoryGb * LOCAL_LLM_MEMORY_HARD_BLOCK_RATIO;
  if (deviceMemoryGb + LOCAL_LLM_MEMORY_EPSILON_GB < hardBlockFloorGb) {
    return 'block';
  }
  if (deviceMemoryGb + LOCAL_LLM_MEMORY_EPSILON_GB < minDeviceMemoryGb) {
    return 'warn';
  }
  return 'ok';
}

export function getFallbackLocalLlmRecommendation(
  modelId: string,
  deviceMemoryGb: number | null,
): LocalLlmModelCatalogEntry | null {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    return null;
  }

  const currentMinDeviceMemoryGb = catalogEntry.minDeviceMemoryGb;
  if (currentMinDeviceMemoryGb == null) {
    return null;
  }

  const candidates = getSupportedLocalLlmCatalogEntries()
    .filter((entry) => {
      if (entry.id === modelId || entry.runtime !== catalogEntry.runtime) {
        return false;
      }

      const candidateMinDeviceMemoryGb = entry.minDeviceMemoryGb;
      if (
        candidateMinDeviceMemoryGb == null ||
        candidateMinDeviceMemoryGb >= currentMinDeviceMemoryGb
      ) {
        return false;
      }

      if (deviceMemoryGb == null) {
        return true;
      }

      return (
        getLocalLlmMemoryRequirementStatus(candidateMinDeviceMemoryGb, deviceMemoryGb) !== 'block'
      );
    })
    .sort((left, right) => (right.minDeviceMemoryGb || 0) - (left.minDeviceMemoryGb || 0));

  return candidates[0] || null;
}

export function buildFallbackLocalLlmSuggestion(
  policy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number | null,
): string {
  const fallbackEntry = getFallbackLocalLlmRecommendation(policy.modelId, deviceMemoryGb);
  if (!fallbackEntry) {
    return '';
  }

  return ` Try ${fallbackEntry.name} instead on this device.`;
}

export function buildLowMemoryLocalLlmReason(
  policy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number,
): string {
  return `${policy.modelName} is officially recommended for devices with at least ${policy.minDeviceMemoryGb} GB of memory. This device reports about ${formatLocalLlmMemoryGb(deviceMemoryGb)} GB, which is materially below that recommendation. To avoid startup failures, this model is blocked on this device.${buildFallbackLocalLlmSuggestion(policy, deviceMemoryGb)}`;
}

export function buildBorderlineLocalLlmMemoryWarning(
  policy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number,
): string {
  const capNote =
    policy.maxTokens < policy.recommendedMaxTokens
      ? ` To reduce startup failures on this device, output is capped to about ${policy.maxTokens} tokens.`
      : '';
  return `${policy.modelName} is officially recommended for devices with at least ${policy.minDeviceMemoryGb} GB of memory. This device reports about ${formatLocalLlmMemoryGb(deviceMemoryGb)} GB, so performance or stability may be limited, but you can still try it.${capNote}${buildFallbackLocalLlmSuggestion(policy, deviceMemoryGb)}`;
}

export function buildConstrainedLocalLlmExecutionWarning(
  policy: LocalLlmExecutionPolicy,
): string | null {
  if (policy.maxTokens >= policy.recommendedMaxTokens) {
    return null;
  }

  return `${policy.modelName} will use a conservative ${policy.maxTokens}-token output cap on this device to reduce startup failures near the minimum memory requirement.`;
}

export function buildLowRamLocalLlmReason(policy: LocalLlmExecutionPolicy): string {
  return `${policy.modelName} is not supported on Android low-RAM devices.`;
}

export function shouldWarmupLocalLlmEngine(
  executionPolicy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number | null,
  conversationScoped: boolean,
): boolean {
  if (conversationScoped) {
    return true;
  }

  if (getCurrentLocalLlmPlatform() !== 'android' || executionPolicy.runtime !== 'litert-lm') {
    return true;
  }

  if (executionPolicy.minDeviceMemoryGb == null || deviceMemoryGb == null) {
    return true;
  }

  const memoryRequirementStatus = getLocalLlmMemoryRequirementStatus(
    executionPolicy.minDeviceMemoryGb,
    deviceMemoryGb,
  );

  if (memoryRequirementStatus !== 'ok') {
    return false;
  }

  return (
    deviceMemoryGb >
    executionPolicy.minDeviceMemoryGb +
      LOCAL_LLM_NEAR_MINIMUM_MEMORY_HEADROOM_GB +
      LOCAL_LLM_MEMORY_EPSILON_GB
  );
}
