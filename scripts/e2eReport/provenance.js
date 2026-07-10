const { createHash } = require('crypto');

const PUBLIC_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const PUBLIC_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{7,64}$/u;
const PUBLIC_HOSTED_FAMILIES = new Set([
  'openai',
  'anthropic',
  'gemini',
  'deepseek',
  'qwen',
  'kimi',
  'mistral',
  'ollama',
  'unknown',
]);
const PROMPT_CACHE_MODES = new Set(['provider-default', 'enabled', 'disabled']);
const MAX_SEED = 0xffffffff;

function normalizeHostedModelId(model) {
  const normalized = String(model || '')
    .trim()
    .toLowerCase();
  const stripped = normalized
    .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//, '')
    .replace(/^publishers\/[^/]+\/models\//, '')
    .replace(/^models\//, '');
  const segments = stripped.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function resolveHostedFamily(model) {
  const normalized = normalizeHostedModelId(model);
  if (normalized.startsWith('gpt-') || /^o[134](?:[.-]|$)/.test(normalized)) return 'openai';
  if (/^claude(?:[.-]|$)/.test(normalized)) return 'anthropic';
  if (/^gemini(?:[.-]|$)/.test(normalized)) return 'gemini';
  if (/^deepseek(?:[.-]|$)/.test(normalized)) return 'deepseek';
  if (/^qwen(?:[.-]|$|\d)/.test(normalized)) return 'qwen';
  if (/^(?:kimi|moonshot)(?:[.-]|$)/.test(normalized)) return 'kimi';
  return 'unknown';
}

function requireNonEmptyString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function assertPublicModelId(value) {
  const normalized = requireNonEmptyString(value, 'Public model id');
  if (
    normalized.length > 192 ||
    !PUBLIC_MODEL_ID_PATTERN.test(normalized) ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new Error('Public model id must be a path-free model identifier');
  }
  return normalized;
}

function derivePublicModelId(modelLocator) {
  const locator = requireNonEmptyString(modelLocator, 'Model locator');
  const segments = locator.split('/');
  if (
    locator.startsWith('/') ||
    locator.startsWith('\\') ||
    locator.includes('\\') ||
    locator.includes('?') ||
    locator.includes('#') ||
    locator.includes('@') ||
    locator.includes(':') ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Model locator requires an explicit public model id');
  }
  return assertPublicModelId(segments[segments.length - 1]);
}

function normalizePrivateLocatorForDigest(locator) {
  const trimmed = String(locator ?? '').trim();
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

function digestPrivateLocator(locator) {
  return createHash('sha256').update(normalizePrivateLocatorForDigest(locator)).digest('hex');
}

function digestModelLocator(modelLocator) {
  return digestPrivateLocator(requireNonEmptyString(modelLocator, 'Model locator'));
}

function resolvePublicModelIdentity({ providerKey, modelLocator, publicModelId }) {
  const normalizedProviderKey = requireNonEmptyString(providerKey, 'Provider key').toLowerCase();
  const normalizedLocator = requireNonEmptyString(modelLocator, 'Model locator');
  const explicitPublicModelId = String(publicModelId ?? '').trim();
  if (
    !explicitPublicModelId &&
    (normalizedProviderKey === 'compatible' ||
      normalizedProviderKey === 'custom' ||
      normalizedProviderKey === 'local')
  ) {
    throw new Error('Compatible and local providers require E2E_PUBLIC_MODEL_ID');
  }
  return {
    model: explicitPublicModelId
      ? assertPublicModelId(explicitPublicModelId)
      : derivePublicModelId(normalizedLocator),
    modelIdentitySource: explicitPublicModelId ? 'explicit-public-id' : 'provider-model-id',
    modelLocatorSha256: digestModelLocator(normalizedLocator),
  };
}

function assertGitSha(value) {
  const normalized = requireNonEmptyString(value, 'Git SHA').toLowerCase();
  if (!GIT_SHA_PATTERN.test(normalized)) {
    throw new Error('Git SHA must be a 7 to 64 character hexadecimal revision');
  }
  return normalized;
}

function assertPublicRevision(value, label = 'Revision') {
  const normalized = requireNonEmptyString(value, label);
  if (!PUBLIC_REVISION_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a public revision token`);
  }
  return normalized;
}

function resolveOptionalPublicRevision(value, label = 'Revision') {
  return value === undefined || value === null || String(value).trim() === ''
    ? undefined
    : assertPublicRevision(value, label);
}

function assertPublicHostedFamily(value) {
  const normalized = requireNonEmptyString(value, 'Hosted model family').toLowerCase();
  if (!PUBLIC_HOSTED_FAMILIES.has(normalized)) {
    throw new Error('Hosted model family must be a supported public family');
  }
  return normalized;
}

function resolvePromptCacheMode(value) {
  const normalized = String(value ?? 'provider-default').trim() || 'provider-default';
  if (!PROMPT_CACHE_MODES.has(normalized)) {
    throw new Error('Prompt cache mode must be provider-default, enabled, or disabled');
  }
  return normalized;
}

function resolveOptionalSeed(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  const raw = typeof value === 'number' ? undefined : String(value).trim();
  if (raw !== undefined && !/^(?:0|[1-9][0-9]{0,9})$/u.test(raw)) {
    throw new Error('E2E seed must be an unsigned 32-bit integer');
  }
  const normalized = typeof value === 'number' ? value : Number(raw);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > MAX_SEED) {
    throw new Error('E2E seed must be an unsigned 32-bit integer');
  }
  return normalized;
}

function normalizeEndpointForDigest(endpoint) {
  return normalizePrivateLocatorForDigest(endpoint);
}

function digestProviderEndpoint(endpoint) {
  return digestPrivateLocator(endpoint);
}

module.exports = {
  assertGitSha,
  assertPublicHostedFamily,
  assertPublicModelId,
  assertPublicRevision,
  derivePublicModelId,
  digestModelLocator,
  digestProviderEndpoint,
  normalizeEndpointForDigest,
  normalizeHostedModelId,
  normalizePrivateLocatorForDigest,
  resolveOptionalPublicRevision,
  resolveOptionalSeed,
  resolvePromptCacheMode,
  resolveHostedFamily,
  resolvePublicModelIdentity,
};
