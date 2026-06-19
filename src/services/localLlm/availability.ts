import { getNativeLocalLlmAvailability } from './native';
import { getCurrentLocalLlmPlatform, getLocalLlmCatalogEntry } from './catalog';
import {
  buildBorderlineLocalLlmMemoryWarning,
  buildConstrainedLocalLlmExecutionWarning,
  buildLowMemoryLocalLlmReason,
  buildLowRamLocalLlmReason,
  buildUnsupportedLocalLlmPlatformReason,
  getLocalLlmMemoryRequirementStatus,
} from './memoryPolicy';
import { resolveLocalLlmAccelerator } from './backendPolicy';
import { getLocalLlmExecutionPolicy } from './executionPolicy';
import type { LocalLlmAvailability } from './types';

export async function ensureLocalLlmModelCanRun(modelId: string): Promise<LocalLlmAvailability> {
  const availability = await getLocalLlmAvailability(modelId);
  if (!availability.available) {
    throw new Error(
      availability.reason || `On-device model ${modelId} is unavailable on this device.`,
    );
  }
  return availability;
}

export async function getLocalLlmAvailability(modelId?: string): Promise<LocalLlmAvailability> {
  const nativeAvailability = await getNativeLocalLlmAvailability();
  if (!modelId) {
    return {
      ...nativeAvailability,
      warningReason: null,
    };
  }

  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  const executionPolicy = getLocalLlmExecutionPolicy(modelId, {
    backend: resolveLocalLlmAccelerator(
      { model: modelId, local: { runtime: catalogEntry?.runtime || 'litert-lm' } },
      modelId,
      nativeAvailability.deviceMemoryGb ?? null,
    ),
    deviceMemoryGb: nativeAvailability.deviceMemoryGb ?? null,
  });

  if (!catalogEntry) {
    return {
      ...nativeAvailability,
      available: false,
      modelId,
      reason: `Unknown local model: ${modelId}.`,
      minDeviceMemoryGb: null,
      recommendedMaxTokens: null,
      warningReason: null,
    };
  }

  if (!catalogEntry.supportedPlatforms.includes(getCurrentLocalLlmPlatform())) {
    return {
      ...nativeAvailability,
      available: false,
      modelId,
      runtime: nativeAvailability.runtime || executionPolicy.runtime,
      reason: buildUnsupportedLocalLlmPlatformReason(modelId),
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
      recommendedMaxTokens: executionPolicy.maxTokens,
      warningReason: null,
    };
  }

  if (!nativeAvailability.available) {
    return {
      ...nativeAvailability,
      modelId,
      runtime: nativeAvailability.runtime || executionPolicy.runtime,
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
      recommendedMaxTokens: executionPolicy.maxTokens,
      warningReason: buildConstrainedLocalLlmExecutionWarning(executionPolicy),
    };
  }

  if (nativeAvailability.lowMemoryDevice) {
    return {
      ...nativeAvailability,
      available: false,
      modelId,
      reason: buildLowRamLocalLlmReason(executionPolicy),
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
      recommendedMaxTokens: executionPolicy.maxTokens,
      warningReason: null,
    };
  }

  const deviceMemoryGb =
    typeof nativeAvailability.deviceMemoryGb === 'number' &&
    Number.isFinite(nativeAvailability.deviceMemoryGb)
      ? nativeAvailability.deviceMemoryGb
      : null;

  if (executionPolicy.minDeviceMemoryGb != null && deviceMemoryGb != null) {
    const memoryRequirementStatus = getLocalLlmMemoryRequirementStatus(
      executionPolicy.minDeviceMemoryGb,
      deviceMemoryGb,
    );

    if (memoryRequirementStatus === 'block') {
      return {
        ...nativeAvailability,
        available: false,
        modelId,
        reason: buildLowMemoryLocalLlmReason(executionPolicy, deviceMemoryGb),
        minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
        recommendedMaxTokens: executionPolicy.maxTokens,
        warningReason: null,
      };
    }

    if (memoryRequirementStatus === 'warn') {
      return {
        ...nativeAvailability,
        modelId,
        runtime: nativeAvailability.runtime || executionPolicy.runtime,
        minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
        recommendedMaxTokens: executionPolicy.maxTokens,
        warningReason: buildBorderlineLocalLlmMemoryWarning(executionPolicy, deviceMemoryGb),
      };
    }
  }

  return {
    ...nativeAvailability,
    modelId,
    runtime: nativeAvailability.runtime || executionPolicy.runtime,
    minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
    recommendedMaxTokens: executionPolicy.maxTokens,
    warningReason: buildConstrainedLocalLlmExecutionWarning(executionPolicy),
  };
}
