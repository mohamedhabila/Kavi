import { DEFAULT_OPENAI_BASE_URL } from '../../constants/api';
import type { LlmProviderConfig } from '../../types/provider';
import { getProviderApiKey, getSecure } from '../storage/SecureStorage';

export interface SpeechBackendConfig {
  apiKey: string;
  baseUrl: string;
  providerName: string;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
}

function isSupportedSpeechProvider(provider: LlmProviderConfig): boolean {
  if (!provider.baseUrl) return false;

  try {
    const normalized = new URL(provider.baseUrl);
    const host = normalized.hostname.toLowerCase();

    if (host === 'api.openai.com' || host.endsWith('.openai.com')) return true;
    if (host === 'api.groq.com' || host.endsWith('.groq.com')) return true;
    return false;
  } catch {
    return false;
  }
}

export function getWhisperModel(baseUrl: string): string {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'api.groq.com' || host.endsWith('.groq.com')) return 'whisper-large-v3-turbo';
  } catch {
    /* ignore */
  }
  return 'whisper-1';
}

async function getEnabledProviders(): Promise<LlmProviderConfig[]> {
  try {
    const { useSettingsStore } = require('../../store/useSettingsStore');
    const state = useSettingsStore.getState();
    const enabledProviders = state.providers.filter(
      (provider: LlmProviderConfig) => provider.enabled,
    );
    const activeProvider = enabledProviders.find(
      (provider: LlmProviderConfig) => provider.id === state.activeProviderId,
    );

    if (!activeProvider) return enabledProviders;

    return [
      activeProvider,
      ...enabledProviders.filter(
        (provider: LlmProviderConfig) => provider.id !== activeProvider.id,
      ),
    ];
  } catch {
    return [];
  }
}

export async function resolveSpeechBackend(): Promise<SpeechBackendConfig | null> {
  const dedicated = await getSecure('OPENAI_API_KEY');
  if (dedicated) {
    return {
      apiKey: dedicated,
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      providerName: 'OpenAI',
    };
  }

  const providers = await getEnabledProviders();
  for (const provider of providers) {
    if (!isSupportedSpeechProvider(provider)) continue;

    const key = await getProviderApiKey(provider.id);
    const apiKey = key || provider.apiKey;
    if (!apiKey) continue;

    return {
      apiKey,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      providerName: provider.name,
    };
  }

  return null;
}
