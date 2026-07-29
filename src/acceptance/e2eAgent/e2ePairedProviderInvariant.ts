import type {
  LlmProviderCapabilityHints,
  LlmProviderConfig,
  LlmProviderFamily,
  LlmProviderKind,
  LlmProviderProtocol,
  LocalLlmAccelerator,
  LocalLlmRuntime,
} from '../../types/provider';
import type { ModelCapabilities } from '../../types/tool';
import { stableHash, stableStringify } from './e2eTraceRedaction';

export type E2EPairedProviderInvariant = Readonly<{
  providerIdHash: string;
  kind: LlmProviderKind | null;
  protocol: LlmProviderProtocol | null;
  providerFamily: LlmProviderFamily | null;
  enabled: boolean;
  endpointHash: string;
  modelLocatorHash: string;
  capabilityHints: Readonly<LlmProviderCapabilityHints> | null;
  selectedModelCapabilities: Readonly<ModelCapabilities> | null;
  localRuntime: LocalLlmRuntime | null;
  localBackend: LocalLlmAccelerator | null;
  localMetadataHash: string | null;
}>;

function canonicalHash(value: unknown): string {
  return stableHash(stableStringify(value));
}

function requireTrimmed(value: string, label: string, maxLength = 10_000): string {
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty canonical string.`);
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 hash.`);
  }
  return value;
}

function requireExactKeys(value: object, expectedKeys: ReadonlyArray<string>, label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${label} has an unsupported schema.`);
  }
}

function normalizePrivateLocatorForHash(locator: string): string {
  const trimmed = locator.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function privateLocatorHash(locator: string): string {
  return stableHash(normalizePrivateLocatorForHash(locator));
}

function canonicalCapabilityHints(
  hints: LlmProviderCapabilityHints | undefined,
): LlmProviderCapabilityHints | null {
  if (!hints) return null;
  return {
    ...(hints.preferredProtocol !== undefined
      ? { preferredProtocol: hints.preferredProtocol }
      : {}),
    ...(hints.supportsResponsesApi !== undefined
      ? { supportsResponsesApi: hints.supportsResponsesApi }
      : {}),
    ...(hints.supportsModelDiscovery !== undefined
      ? { supportsModelDiscovery: hints.supportsModelDiscovery }
      : {}),
    ...(hints.supportsImageGeneration !== undefined
      ? { supportsImageGeneration: hints.supportsImageGeneration }
      : {}),
    ...(hints.supportsImageEditing !== undefined
      ? { supportsImageEditing: hints.supportsImageEditing }
      : {}),
    ...(hints.supportsStructuredOutput !== undefined
      ? { supportsStructuredOutput: hints.supportsStructuredOutput }
      : {}),
    ...(hints.supportsTools !== undefined ? { supportsTools: hints.supportsTools } : {}),
    ...(hints.supportsAnthropicMessages !== undefined
      ? { supportsAnthropicMessages: hints.supportsAnthropicMessages }
      : {}),
    ...(hints.supportsGeminiNative !== undefined
      ? { supportsGeminiNative: hints.supportsGeminiNative }
      : {}),
    ...(hints.supportsPromptCaching !== undefined
      ? { supportsPromptCaching: hints.supportsPromptCaching }
      : {}),
  };
}

function canonicalModelCapabilities(
  capabilities: ModelCapabilities | undefined,
): ModelCapabilities | null {
  if (!capabilities) return null;
  return {
    vision: capabilities.vision,
    tools: capabilities.tools,
    fileInput: capabilities.fileInput,
  };
}

function canonicalLocalMetadataHash(local: LlmProviderConfig['local']): string | null {
  if (!local) return null;
  const installedModels = (local.installedModels ?? [])
    .map((installed, index) => ({
      modelIdHash: stableHash(
        requireTrimmed(installed.modelId, `provider.local.installedModels[${index}].modelId`, 512),
      ),
      fileNameHash: stableHash(
        requireTrimmed(
          installed.fileName,
          `provider.local.installedModels[${index}].fileName`,
          512,
        ),
      ),
      localPathHash: privateLocatorHash(
        requireTrimmed(
          installed.localPath,
          `provider.local.installedModels[${index}].localPath`,
          10_000,
        ),
      ),
      sourceUrlHash: privateLocatorHash(
        requireTrimmed(
          installed.sourceUrl,
          `provider.local.installedModels[${index}].sourceUrl`,
          10_000,
        ),
      ),
      repositoryIdHash: installed.repositoryId ? stableHash(installed.repositoryId) : null,
      downloadRevisionHash: installed.downloadRevision
        ? stableHash(installed.downloadRevision)
        : null,
      sizeBytes: installed.sizeBytes ?? null,
    }))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  return canonicalHash({
    runtime: local.runtime,
    backend: local.backend ?? null,
    catalogModelIdHashes: (local.catalogModelIds ?? []).map((id) => stableHash(id)).sort(),
    installedModels,
  });
}

export function buildE2EPairedProviderInvariant(
  provider: LlmProviderConfig,
): E2EPairedProviderInvariant {
  requireTrimmed(provider.id, 'provider.id', 512);
  requireTrimmed(provider.baseUrl, 'provider.baseUrl', 10_000);
  requireTrimmed(provider.model, 'provider.model', 10_000);
  const invariant: E2EPairedProviderInvariant = {
    providerIdHash: stableHash(provider.id),
    kind: provider.kind ?? null,
    protocol: provider.protocol ?? null,
    providerFamily: provider.providerFamily ?? null,
    enabled: provider.enabled,
    endpointHash: privateLocatorHash(provider.baseUrl),
    modelLocatorHash: privateLocatorHash(provider.model),
    capabilityHints: canonicalCapabilityHints(provider.capabilityHints),
    selectedModelCapabilities: canonicalModelCapabilities(
      provider.modelCapabilities?.[provider.model],
    ),
    localRuntime: provider.local?.runtime ?? null,
    localBackend: provider.local?.backend ?? null,
    localMetadataHash: canonicalLocalMetadataHash(provider.local),
  };
  validateE2EPairedProviderInvariant(invariant);
  return invariant;
}

export function validateE2EPairedProviderInvariant(provider: E2EPairedProviderInvariant): void {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('invariantConfig.provider must be an object.');
  }
  requireExactKeys(
    provider,
    [
      'providerIdHash',
      'kind',
      'protocol',
      'providerFamily',
      'enabled',
      'endpointHash',
      'modelLocatorHash',
      'capabilityHints',
      'selectedModelCapabilities',
      'localRuntime',
      'localBackend',
      'localMetadataHash',
    ],
    'invariantConfig.provider',
  );
  requireHash(provider.providerIdHash, 'invariantConfig.provider.providerIdHash');
  requireHash(provider.endpointHash, 'invariantConfig.provider.endpointHash');
  requireHash(provider.modelLocatorHash, 'invariantConfig.provider.modelLocatorHash');
  if (provider.localMetadataHash !== null) {
    requireHash(provider.localMetadataHash, 'invariantConfig.provider.localMetadataHash');
  }
  if (typeof provider.enabled !== 'boolean') {
    throw new Error('invariantConfig.provider.enabled must be a boolean.');
  }
  if (provider.kind !== null && !['remote', 'on-device'].includes(provider.kind)) {
    throw new Error('invariantConfig.provider.kind is unsupported.');
  }
  if (
    provider.protocol !== null &&
    ![
      'auto',
      'openai-responses',
      'openai-chat',
      'anthropic-messages',
      'gemini-native',
      'local',
    ].includes(provider.protocol)
  ) {
    throw new Error('invariantConfig.provider.protocol is unsupported.');
  }
  if (
    provider.providerFamily !== null &&
    ![
      'openai',
      'openrouter',
      'deepseek',
      'qwen',
      'kimi',
      'mistral',
      'voyage',
      'anthropic',
      'gemini',
      'ollama',
      'custom',
    ].includes(provider.providerFamily)
  ) {
    throw new Error('invariantConfig.provider.providerFamily is unsupported.');
  }
  if (provider.localRuntime !== null && provider.localRuntime !== 'litert-lm') {
    throw new Error('invariantConfig.provider.localRuntime is unsupported.');
  }
  if (
    provider.localBackend !== null &&
    !['cpu', 'gpu', 'npu', 'tpu'].includes(provider.localBackend)
  ) {
    throw new Error('invariantConfig.provider.localBackend is unsupported.');
  }
  validateCapabilityHints(provider.capabilityHints);
  if (provider.selectedModelCapabilities !== null) {
    requireExactKeys(
      provider.selectedModelCapabilities,
      ['vision', 'tools', 'fileInput'],
      'invariantConfig.provider.selectedModelCapabilities',
    );
    for (const value of Object.values(provider.selectedModelCapabilities)) {
      if (typeof value !== 'boolean') {
        throw new Error('invariantConfig.provider.selectedModelCapabilities must be boolean.');
      }
    }
  }
}

function validateCapabilityHints(hints: Readonly<LlmProviderCapabilityHints> | null): void {
  if (hints === null) return;
  if (typeof hints !== 'object' || Array.isArray(hints)) {
    throw new Error('invariantConfig.provider.capabilityHints must be an object.');
  }
  const allowedHintKeys = [
    'preferredProtocol',
    'supportsResponsesApi',
    'supportsModelDiscovery',
    'supportsImageGeneration',
    'supportsImageEditing',
    'supportsStructuredOutput',
    'supportsTools',
    'supportsAnthropicMessages',
    'supportsGeminiNative',
    'supportsPromptCaching',
  ];
  for (const [key, value] of Object.entries(hints)) {
    if (!allowedHintKeys.includes(key)) {
      throw new Error('invariantConfig.provider.capabilityHints has an unsupported schema.');
    }
    if (key !== 'preferredProtocol' && typeof value !== 'boolean') {
      throw new Error('invariantConfig.provider.capabilityHints must contain typed flags.');
    }
    if (
      key === 'preferredProtocol' &&
      !['openai-responses', 'openai-chat', 'anthropic-messages', 'gemini-native', 'local'].includes(
        String(value),
      )
    ) {
      throw new Error('invariantConfig.provider.capabilityHints has an invalid protocol.');
    }
  }
}
