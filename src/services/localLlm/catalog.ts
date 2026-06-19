import { Platform } from 'react-native';
import type {
  LocalLlmAccelerator,
  LocalLlmModelCatalogEntry,
  LocalLlmModelFamily,
  LocalLlmPlatform,
  LlmProviderConfig,
} from '../../types/provider';
import type { ModelCapabilities } from '../../types/tool';
import {
  RAW_LOCAL_MODEL_CATALOG,
  type LocalLlmRawCatalogEntry,
} from './catalogRaw';

export {
  DEFAULT_LITERT_LM_TEMPERATURE,
  DEFAULT_LITERT_LM_TOP_K,
  DEFAULT_LITERT_LM_TOP_P,
} from './catalogDefaults';

export const DEFAULT_LOCAL_LLM_ACCELERATOR: LocalLlmAccelerator = 'cpu';
export const ON_DEVICE_PROVIDER_NAME = 'On-device models';

function formatCatalogSizeLabel(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = value >= 10 || unitIndex === 0 ? 0 : 2;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)} ${units[unitIndex]}`;
}

function buildHuggingFaceDownloadUrl(
  repositoryId: string,
  downloadRevision: string,
  fileName: string,
): string {
  return `https://huggingface.co/${repositoryId}/resolve/${downloadRevision}/${fileName}?download=true`;
}

function buildLocalModelCapabilities(entry: LocalLlmRawCatalogEntry): ModelCapabilities {
  return {
    vision: entry.supportsVision,
    tools: entry.supportsTools,
    fileInput: entry.supportsFileInput,
  };
}

function createCatalogEntry(entry: LocalLlmRawCatalogEntry): LocalLlmModelCatalogEntry {
  return {
    ...entry,
    downloadUrl: buildHuggingFaceDownloadUrl(
      entry.repositoryId,
      entry.downloadRevision,
      entry.fileName,
    ),
    sizeLabel: formatCatalogSizeLabel(entry.sizeBytes),
    capabilities: buildLocalModelCapabilities(entry),
  };
}

const ALL_LOCAL_MODEL_CATALOG = RAW_LOCAL_MODEL_CATALOG.map(createCatalogEntry);

export const LOCAL_LLM_MODEL_CATALOG = ALL_LOCAL_MODEL_CATALOG;

function compareLocalLlmCatalogEntriesForGeneralUse(
  left: LocalLlmModelCatalogEntry,
  right: LocalLlmModelCatalogEntry,
): number {
  const leftMemory = left.minDeviceMemoryGb ?? Number.MAX_SAFE_INTEGER;
  const rightMemory = right.minDeviceMemoryGb ?? Number.MAX_SAFE_INTEGER;
  if (leftMemory !== rightMemory) {
    return leftMemory - rightMemory;
  }

  if (left.sizeBytes !== right.sizeBytes) {
    return left.sizeBytes - right.sizeBytes;
  }

  const leftMultimodalPenalty = Number(
    Boolean(left.capabilities.vision || left.supportsAudioInput),
  );
  const rightMultimodalPenalty = Number(
    Boolean(right.capabilities.vision || right.supportsAudioInput),
  );
  if (leftMultimodalPenalty !== rightMultimodalPenalty) {
    return leftMultimodalPenalty - rightMultimodalPenalty;
  }

  const leftToolPenalty = Number(Boolean(left.capabilities.tools));
  const rightToolPenalty = Number(Boolean(right.capabilities.tools));
  if (leftToolPenalty !== rightToolPenalty) {
    return leftToolPenalty - rightToolPenalty;
  }

  return left.name.localeCompare(right.name);
}

function sortLocalLlmCatalogEntriesForGeneralUse(
  entries: readonly LocalLlmModelCatalogEntry[],
): LocalLlmModelCatalogEntry[] {
  return entries.slice().sort(compareLocalLlmCatalogEntriesForGeneralUse);
}

export function getCurrentLocalLlmPlatform(): LocalLlmPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

export function getDefaultLocalLlmAccelerator(
  modelId: string = DEFAULT_LOCAL_LLM_MODEL_ID,
): LocalLlmAccelerator {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (catalogEntry?.supportedBackends.includes('gpu')) {
    return 'gpu';
  }
  return DEFAULT_LOCAL_LLM_ACCELERATOR;
}

export function getSupportedLocalLlmCatalogEntries(
  platform: LocalLlmPlatform = getCurrentLocalLlmPlatform(),
): LocalLlmModelCatalogEntry[] {
  const supportedEntries = sortLocalLlmCatalogEntriesForGeneralUse(
    ALL_LOCAL_MODEL_CATALOG.filter((entry) => entry.supportedPlatforms.includes(platform)),
  );
  return supportedEntries.length > 0 ? supportedEntries : ALL_LOCAL_MODEL_CATALOG;
}

export const DEFAULT_LOCAL_LLM_MODEL_ID =
  getSupportedLocalLlmCatalogEntries()[0]?.id || ALL_LOCAL_MODEL_CATALOG[0].id;

export function getLocalLlmCatalogEntry(modelId: string): LocalLlmModelCatalogEntry | undefined {
  return ALL_LOCAL_MODEL_CATALOG.find((entry) => entry.id === modelId);
}

export function getLocalLlmCatalogEntriesForProvider(
  provider?: Pick<LlmProviderConfig, 'local'> | null,
): LocalLlmModelCatalogEntry[] {
  const supportedEntries = getSupportedLocalLlmCatalogEntries();
  const configuredIds = provider?.local?.catalogModelIds;
  if (!configuredIds || configuredIds.length === 0) {
    return supportedEntries;
  }

  const resolved = configuredIds
    .map((id) => getLocalLlmCatalogEntry(id))
    .filter((entry): entry is LocalLlmModelCatalogEntry => Boolean(entry))
    .filter((entry) => entry.supportedPlatforms.includes(getCurrentLocalLlmPlatform()));

  return resolved.length > 0 ? resolved : supportedEntries;
}

export function getLocalLlmModelCapabilities(modelId: string): ModelCapabilities {
  return (
    getLocalLlmCatalogEntry(modelId)?.capabilities || {
      vision: false,
      tools: false,
      fileInput: false,
    }
  );
}

export function getLocalLlmModelDisplayName(modelId: string): string {
  return getLocalLlmCatalogEntry(modelId)?.name || modelId;
}

export function getLocalLlmModelFamilies(
  platform: LocalLlmPlatform = getCurrentLocalLlmPlatform(),
): LocalLlmModelFamily[] {
  return Array.from(
    new Set(getSupportedLocalLlmCatalogEntries(platform).map((entry) => entry.family)),
  );
}
