export type E2EPublicHostedFamily =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'mistral'
  | 'ollama'
  | 'unknown';

export type E2EPromptCacheMode = 'provider-default' | 'enabled' | 'disabled';

export type E2EPublicModelIdentity = {
  model: string;
  modelIdentitySource: 'provider-model-id' | 'explicit-public-id';
  modelLocatorSha256: string;
};

export function normalizeHostedModelId(model: string | undefined): string;
export function resolveHostedFamily(model: string | undefined): E2EPublicHostedFamily;
export function assertPublicHostedFamily(value: unknown): E2EPublicHostedFamily;
export function assertPublicModelId(value: unknown): string;
export function derivePublicModelId(modelLocator: unknown): string;
export function resolvePublicModelIdentity(params: {
  providerKey: string;
  modelLocator: unknown;
  publicModelId?: unknown;
}): E2EPublicModelIdentity;
export function normalizePrivateLocatorForDigest(locator: unknown): string;
export function digestModelLocator(modelLocator: unknown): string;
export function normalizeEndpointForDigest(endpoint: string | undefined): string;
export function digestProviderEndpoint(endpoint: string | undefined): string;
export function assertGitSha(value: unknown): string;
export function assertPublicRevision(value: unknown, label?: string): string;
export function resolveOptionalPublicRevision(value: unknown, label?: string): string | undefined;
export function resolvePromptCacheMode(value: unknown): E2EPromptCacheMode;
export function resolveOptionalSeed(value: unknown): number | undefined;
