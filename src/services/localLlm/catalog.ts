import { Platform } from 'react-native';
import type {
  LocalLlmBackend,
  LocalLlmModelCatalogEntry,
  LocalLlmPlatform,
  LlmProviderConfig,
  ModelCapabilities,
} from '../../types';

const ANDROID_LITERT_LOCAL_CAPABILITIES: ModelCapabilities = {
  vision: false,
  tools: true,
  fileInput: false,
};

const TEXT_ONLY_LOCAL_CAPABILITIES: ModelCapabilities = {
  vision: false,
  tools: false,
  fileInput: false,
};

export const DEFAULT_LOCAL_LLM_BACKEND: LocalLlmBackend = 'cpu';
export const DEFAULT_LITERT_LM_TOP_K = 64;
export const DEFAULT_LITERT_LM_TOP_P = 0.95;
export const DEFAULT_LITERT_LM_TEMPERATURE = 1.0;

export const GEMMA_LOCAL_PROVIDER_NAME = 'Gemma (on-device)';

const ALL_LOCAL_MODEL_CATALOG: LocalLlmModelCatalogEntry[] = [
  {
    id: 'gemma-4-E2B-it',
    name: 'Gemma 4 E2B',
    runtime: 'litert-lm',
    fileName: 'gemma-4-E2B-it.litertlm',
    repositoryId: 'litert-community/gemma-4-E2B-it-litert-lm',
    downloadUrl:
      'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm?download=true',
    sizeBytes: 2_583_085_056,
    sizeLabel: '2.58 GB',
    maxContextLength: 32_000,
    defaultMaxTokens: 4_000,
    defaultTopK: DEFAULT_LITERT_LM_TOP_K,
    defaultTopP: DEFAULT_LITERT_LM_TOP_P,
    defaultTemperature: DEFAULT_LITERT_LM_TEMPERATURE,
    minDeviceMemoryGb: 8,
    supportedPlatforms: ['android'],
    capabilities: { ...ANDROID_LITERT_LOCAL_CAPABILITIES },
    summary: 'Smaller Gemma 4 instruction model for phones and tablets.',
  },
  {
    id: 'gemma-4-E4B-it',
    name: 'Gemma 4 E4B',
    runtime: 'litert-lm',
    fileName: 'gemma-4-E4B-it.litertlm',
    repositoryId: 'litert-community/gemma-4-E4B-it-litert-lm',
    downloadUrl:
      'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm?download=true',
    sizeBytes: 3_654_467_584,
    sizeLabel: '3.65 GB',
    maxContextLength: 32_000,
    defaultMaxTokens: 4_000,
    defaultTopK: DEFAULT_LITERT_LM_TOP_K,
    defaultTopP: DEFAULT_LITERT_LM_TOP_P,
    defaultTemperature: DEFAULT_LITERT_LM_TEMPERATURE,
    minDeviceMemoryGb: 12,
    supportedPlatforms: ['android'],
    capabilities: { ...ANDROID_LITERT_LOCAL_CAPABILITIES },
    summary: 'Larger Gemma 4 instruction model with higher quality at a higher storage cost.',
  },
  {
    id: 'gemma-3-1b-it',
    name: 'Gemma 3 1B',
    runtime: 'mediapipe-genai',
    fileName: 'gemma3-1b-it-int4.task',
    repositoryId: 'litert-community/Gemma3-1B-IT',
    downloadUrl:
      'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4.task?download=true',
    sizeBytes: 700_000_000,
    sizeLabel: '~0.7 GB',
    defaultMaxTokens: 1_024,
    supportedPlatforms: ['ios'],
    capabilities: { ...TEXT_ONLY_LOCAL_CAPABILITIES },
    summary:
      'Compact Gemma 3 instruction model supported by the official iOS MediaPipe sample runtime.',
  },
];

export const GEMMA_LOCAL_MODEL_CATALOG = ALL_LOCAL_MODEL_CATALOG;

export function getCurrentLocalLlmPlatform(): LocalLlmPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

export function getDefaultLocalLlmBackend(
  modelId: string = DEFAULT_LOCAL_LLM_MODEL_ID,
  platform: LocalLlmPlatform = getCurrentLocalLlmPlatform(),
): LocalLlmBackend {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (platform === 'android' && catalogEntry?.runtime === 'litert-lm') {
    return 'gpu';
  }
  return DEFAULT_LOCAL_LLM_BACKEND;
}

export function getSupportedLocalLlmCatalogEntries(
  platform: LocalLlmPlatform = getCurrentLocalLlmPlatform(),
): LocalLlmModelCatalogEntry[] {
  const supportedEntries = ALL_LOCAL_MODEL_CATALOG.filter((entry) =>
    entry.supportedPlatforms.includes(platform),
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
  return getLocalLlmCatalogEntry(modelId)?.capabilities || { ...TEXT_ONLY_LOCAL_CAPABILITIES };
}

export function getLocalLlmModelDisplayName(modelId: string): string {
  return getLocalLlmCatalogEntry(modelId)?.name || modelId;
}
