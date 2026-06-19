const {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENROUTER_BASE_URL,
} = require('./constants');

const E2E_PROVIDER_SPECS = [
  {
    key: 'gemini',
    aliases: ['gemini', 'google'],
    id: 'e2e-gemini',
    provider: 'gemini',
    apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    modelEnv: ['E2E_GEMINI_MODEL'],
    baseUrlEnv: ['GEMINI_BASE_URL'],
    defaultModel: DEFAULT_GEMINI_MODEL,
    defaultBaseUrl: DEFAULT_GEMINI_BASE_URL,
  },
  {
    key: 'openai',
    aliases: ['openai'],
    id: 'e2e-openai',
    provider: 'openai',
    apiKeyEnv: ['OPENAI_API_KEY'],
    modelEnv: ['E2E_OPENAI_MODEL'],
    baseUrlEnv: ['OPENAI_BASE_URL'],
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
  },
  {
    key: 'anthropic',
    aliases: ['anthropic', 'claude'],
    id: 'e2e-anthropic',
    provider: 'anthropic',
    apiKeyEnv: ['ANTHROPIC_API_KEY'],
    modelEnv: ['E2E_ANTHROPIC_MODEL'],
    baseUrlEnv: ['ANTHROPIC_BASE_URL'],
    defaultBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
  },
  {
    key: 'openrouter',
    aliases: ['openrouter'],
    id: 'e2e-openrouter',
    provider: 'openrouter',
    apiKeyEnv: ['OPENROUTER_API_KEY'],
    modelEnv: ['E2E_OPENROUTER_MODEL'],
    baseUrlEnv: ['OPENROUTER_BASE_URL'],
    defaultBaseUrl: DEFAULT_OPENROUTER_BASE_URL,
  },
  {
    key: 'compatible',
    aliases: ['compatible', 'openai-compatible', 'custom'],
    id: 'e2e-compatible',
    provider: 'custom',
    apiKeyEnv: ['E2E_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_API_KEY'],
    modelEnv: ['E2E_COMPATIBLE_MODEL', 'E2E_OPENAI_COMPATIBLE_MODEL'],
    baseUrlEnv: ['E2E_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL'],
  },
];

function readFirstEnvValue(env, envNames) {
  for (const envName of envNames) {
    const value = env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveE2eProviderSpec(env = process.env) {
  const configured = (env.E2E_PROVIDER || env.E2E_PROVIDER_FAMILY || '').trim().toLowerCase();
  return (
    E2E_PROVIDER_SPECS.find((spec) => spec.aliases.includes(configured)) ||
    E2E_PROVIDER_SPECS[0]
  );
}

module.exports = {
  E2E_PROVIDER_SPECS,
  readFirstEnvValue,
  resolveE2eProviderSpec,
};
