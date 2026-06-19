// ---------------------------------------------------------------------------
// Kavi — E2E agent eval provider config (Node/Jest only)
// ---------------------------------------------------------------------------
// Mirrors mobile provider setup for live E2E runs.
// ---------------------------------------------------------------------------

import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  finalizeProviderConfig,
} from '../../constants/api';
import type { LlmProviderConfig, LlmProviderFamily } from '../../types/provider';

export const DEFAULT_E2E_GEMINI_MODEL = 'gemini-3.5-flash';
export const DEFAULT_E2E_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const DEFAULT_E2E_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export type E2EProviderKey = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'compatible';

export type E2EProviderSpec = {
  key: E2EProviderKey;
  aliases: ReadonlyArray<string>;
  id: string;
  name: string;
  family: LlmProviderFamily;
  apiKeyEnv: ReadonlyArray<string>;
  modelEnv: ReadonlyArray<string>;
  baseUrlEnv: ReadonlyArray<string>;
  defaultModel?: string;
  defaultBaseUrl?: string;
};

export const E2E_PROVIDER_SPECS: ReadonlyArray<E2EProviderSpec> = [
  {
    key: 'gemini',
    aliases: ['gemini', 'google'],
    id: 'e2e-gemini',
    name: 'Gemini',
    family: 'gemini',
    apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    modelEnv: ['E2E_GEMINI_MODEL'],
    baseUrlEnv: ['GEMINI_BASE_URL'],
    defaultModel: DEFAULT_E2E_GEMINI_MODEL,
    defaultBaseUrl: DEFAULT_GEMINI_BASE_URL,
  },
  {
    key: 'openai',
    aliases: ['openai'],
    id: 'e2e-openai',
    name: 'OpenAI',
    family: 'openai',
    apiKeyEnv: ['OPENAI_API_KEY'],
    modelEnv: ['E2E_OPENAI_MODEL'],
    baseUrlEnv: ['OPENAI_BASE_URL'],
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
  },
  {
    key: 'anthropic',
    aliases: ['anthropic', 'claude'],
    id: 'e2e-anthropic',
    name: 'Anthropic',
    family: 'anthropic',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    modelEnv: ['E2E_ANTHROPIC_MODEL'],
    baseUrlEnv: ['ANTHROPIC_BASE_URL'],
    defaultBaseUrl: DEFAULT_E2E_ANTHROPIC_BASE_URL,
  },
  {
    key: 'openrouter',
    aliases: ['openrouter'],
    id: 'e2e-openrouter',
    name: 'OpenRouter',
    family: 'openrouter',
    apiKeyEnv: ['OPENROUTER_API_KEY'],
    modelEnv: ['E2E_OPENROUTER_MODEL'],
    baseUrlEnv: ['OPENROUTER_BASE_URL'],
    defaultBaseUrl: DEFAULT_E2E_OPENROUTER_BASE_URL,
  },
  {
    key: 'compatible',
    aliases: ['compatible', 'openai-compatible', 'custom'],
    id: 'e2e-compatible',
    name: 'OpenAI Compatible',
    family: 'custom',
    apiKeyEnv: ['E2E_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_API_KEY'],
    modelEnv: ['E2E_COMPATIBLE_MODEL', 'E2E_OPENAI_COMPATIBLE_MODEL'],
    baseUrlEnv: ['E2E_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL'],
  },
];

export function isE2EAgentEvalEnabled(): boolean {
  return process.env.RUN_E2E_AGENT_EVAL === '1';
}

function readFirstEnvValue(
  envNames: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const envName of envNames) {
    const value = env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function resolveE2EProviderKey(env: NodeJS.ProcessEnv = process.env): E2EProviderKey {
  const configured = (env.E2E_PROVIDER || env.E2E_PROVIDER_FAMILY || '').trim().toLowerCase();
  const spec = E2E_PROVIDER_SPECS.find((candidate) =>
    candidate.aliases.some((alias) => alias === configured),
  );
  return spec?.key ?? 'gemini';
}

export function resolveE2EProviderSpec(
  key: E2EProviderKey = resolveE2EProviderKey(),
): E2EProviderSpec {
  return E2E_PROVIDER_SPECS.find((spec) => spec.key === key) ?? E2E_PROVIDER_SPECS[0]!;
}

export function resolveE2EProviderApiKey(
  key: E2EProviderKey = resolveE2EProviderKey(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readFirstEnvValue(resolveE2EProviderSpec(key).apiKeyEnv, env);
}

export function resolveE2EProviderModel(
  key: E2EProviderKey = resolveE2EProviderKey(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const spec = resolveE2EProviderSpec(key);
  return readFirstEnvValue(spec.modelEnv, env) ?? spec.defaultModel;
}

export function resolveE2EProviderBaseUrl(
  key: E2EProviderKey = resolveE2EProviderKey(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const spec = resolveE2EProviderSpec(key);
  return readFirstEnvValue(spec.baseUrlEnv, env) ?? spec.defaultBaseUrl;
}

export function shouldRunE2EAgentEval(): boolean {
  if (!isE2EAgentEvalEnabled()) {
    return false;
  }
  return Boolean(resolveE2EProviderApiKey(resolveE2EProviderKey()));
}

export function shouldRunE2EProviderDiagnostics(key: E2EProviderKey): boolean {
  return (
    isE2EAgentEvalEnabled() &&
    resolveE2EProviderKey() === key &&
    Boolean(resolveE2EProviderApiKey(key))
  );
}

export function buildE2EProviderForKey(key: E2EProviderKey): LlmProviderConfig {
  const spec = resolveE2EProviderSpec(key);
  const apiKey = resolveE2EProviderApiKey(key);
  if (!apiKey) {
    throw new Error(`E2E ${spec.name} eval requires one of: ${spec.apiKeyEnv.join(', ')}`);
  }

  const model = resolveE2EProviderModel(key);
  if (!model) {
    throw new Error(`E2E ${spec.name} eval requires one of: ${spec.modelEnv.join(', ')}`);
  }

  const baseUrl = resolveE2EProviderBaseUrl(key);
  if (!baseUrl) {
    throw new Error(`E2E ${spec.name} eval requires one of: ${spec.baseUrlEnv.join(', ')}`);
  }

  return finalizeProviderConfig({
    id: spec.id,
    name: spec.name,
    apiKey,
    model,
    enabled: true,
    providerFamily: spec.family,
    baseUrl,
  });
}

export function buildE2EProvider(): LlmProviderConfig {
  return buildE2EProviderForKey(resolveE2EProviderKey());
}
