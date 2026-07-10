import { execFileSync } from 'child_process';

import {
  assertGitSha,
  assertPublicHostedFamily,
  assertPublicRevision,
  digestModelLocator,
  digestProviderEndpoint,
  resolveHostedFamily,
  resolveOptionalPublicRevision,
  resolveOptionalSeed,
  resolvePromptCacheMode,
  resolvePublicModelIdentity,
  type E2EPromptCacheMode,
  type E2EPublicHostedFamily,
} from '../../../scripts/e2eReport/provenance';
import {
  resolveE2EProviderBaseUrl,
  resolveE2EProviderKey,
  resolveE2EProviderModel,
  resolveE2EProviderSpec,
  type E2EProviderKey,
} from './providerConfig';
import { E2E_NATIVE_TOOL_FIXTURE_VERSION, E2E_SCENARIO_MANIFEST_VERSION } from './thresholds';

export type E2ERunReportRunMetadata = {
  gitSha: string;
  provider: string;
  providerId?: string;
  hostedFamily: E2EPublicHostedFamily;
  model: string;
  modelIdentitySource: 'provider-model-id' | 'explicit-public-id';
  modelLocatorSha256: string;
  modelVersion?: string;
  endpointSha256: string;
  temperature?: number;
  seed?: number;
  scenarioManifestVersion: string;
  promptCacheMode: E2EPromptCacheMode;
  nativeToolFixtureVersion: string;
  collectMode: boolean;
};

export type E2ERunMetadataOverrides = {
  providerKey?: E2EProviderKey;
  gitSha?: string;
  hostedFamily?: E2EPublicHostedFamily;
  model?: string;
  modelLocator?: string;
  modelVersion?: string;
  providerEndpoint?: string;
  temperature?: number;
  seed?: number;
  promptCacheMode?: E2EPromptCacheMode;
  collectMode?: boolean;
};

function resolveOptionalTemperature(raw: string | undefined): number | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error('E2E temperature must be a finite number');
  }
  return parsed;
}

function validateTemperature(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    throw new Error('E2E temperature must be a finite number');
  }
  return value;
}

function resolveGitSha(env: NodeJS.ProcessEnv, override: string | undefined): string {
  if (override !== undefined) {
    return assertGitSha(override);
  }
  const configured = env.E2E_GIT_SHA?.trim() || env.GITHUB_SHA?.trim() || env.CI_COMMIT_SHA?.trim();
  if (configured) {
    return assertGitSha(configured);
  }
  try {
    return assertGitSha(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    return 'unknown';
  }
}

function requireMetadataValue(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required for public E2E run provenance`);
  }
  return normalized;
}

export const digestE2EProviderEndpoint = digestProviderEndpoint;
export const digestE2EModelLocator = digestModelLocator;

export function resolveE2ERunMetadata(
  overrides?: E2ERunMetadataOverrides,
  env: NodeJS.ProcessEnv = process.env,
): E2ERunReportRunMetadata {
  const providerKey = overrides?.providerKey ?? resolveE2EProviderKey(env);
  const providerSpec = resolveE2EProviderSpec(providerKey);
  const modelLocator = requireMetadataValue(
    overrides?.modelLocator ?? resolveE2EProviderModel(providerKey, env),
    'Model locator',
  );
  const modelIdentity = resolvePublicModelIdentity({
    providerKey,
    modelLocator,
    publicModelId: overrides?.model ?? env.E2E_PUBLIC_MODEL_ID,
  });
  const configuredHostedFamily = overrides?.hostedFamily ?? env.E2E_PUBLIC_HOSTED_FAMILY;
  const hostedFamily = configuredHostedFamily
    ? assertPublicHostedFamily(configuredHostedFamily)
    : resolveHostedFamily(modelLocator);
  const providerEndpoint = requireMetadataValue(
    overrides?.providerEndpoint ?? resolveE2EProviderBaseUrl(providerKey, env),
    'Provider endpoint',
  );
  const modelVersion = resolveOptionalPublicRevision(
    overrides?.modelVersion ?? env.E2E_MODEL_VERSION,
    'Model version',
  );
  const temperature = validateTemperature(
    overrides?.temperature ?? resolveOptionalTemperature(env.E2E_TEMPERATURE),
  );
  const seed = resolveOptionalSeed(overrides?.seed ?? env.E2E_SEED);

  return {
    gitSha: resolveGitSha(env, overrides?.gitSha),
    provider: providerSpec.family,
    providerId: providerSpec.id,
    hostedFamily,
    ...modelIdentity,
    ...(modelVersion ? { modelVersion } : {}),
    endpointSha256: digestE2EProviderEndpoint(providerEndpoint),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(seed !== undefined ? { seed } : {}),
    scenarioManifestVersion: assertPublicRevision(
      E2E_SCENARIO_MANIFEST_VERSION,
      'Scenario manifest version',
    ),
    promptCacheMode: resolvePromptCacheMode(
      overrides?.promptCacheMode ?? env.E2E_PROMPT_CACHE_MODE,
    ),
    nativeToolFixtureVersion: assertPublicRevision(
      E2E_NATIVE_TOOL_FIXTURE_VERSION,
      'Native tool fixture version',
    ),
    collectMode: overrides?.collectMode ?? env.E2E_COLLECT_MODE === '1',
  };
}
