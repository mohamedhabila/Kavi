// ---------------------------------------------------------------------------
// Kavi — Secure Storage Service
// ---------------------------------------------------------------------------
// Uses expo-secure-store for sensitive data (API keys, tokens).
// Falls back to AsyncStorage only for development and test runtimes where
// SecureStore can be unavailable (for example unsigned simulator builds).

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'kavi_';
const FALLBACK_PREFIX = '@kavi_secure_';

function getFallbackKey(key: string): string {
  return `${FALLBACK_PREFIX}${key}`;
}

function allowInsecureFallback(): boolean {
  return (
    Boolean(process.env.JEST_WORKER_ID) ||
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    Boolean((globalThis as { __DEV__?: boolean }).__DEV__)
  );
}

async function clearFallbackValue(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(getFallbackKey(key));
  } catch {
    // Ignore fallback cleanup failures.
  }
}

export async function saveSecure(key: string, value: string): Promise<void> {
  const fullKey = `${KEY_PREFIX}${key}`;
  try {
    await SecureStore.setItemAsync(fullKey, value);
    await clearFallbackValue(key);
    return;
  } catch (error) {
    if (!allowInsecureFallback()) {
      throw error;
    }
  }

  await AsyncStorage.setItem(getFallbackKey(key), value);
}

export async function getSecure(key: string): Promise<string | null> {
  const fullKey = `${KEY_PREFIX}${key}`;
  try {
    const val = await SecureStore.getItemAsync(fullKey);
    if (val !== null) {
      await clearFallbackValue(key);
      return val;
    }
  } catch {
    if (!allowInsecureFallback()) {
      return null;
    }
  }

  if (!allowInsecureFallback()) {
    return null;
  }

  try {
    return await AsyncStorage.getItem(getFallbackKey(key));
  } catch {
    return null;
  }
}

export async function deleteSecure(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(`${KEY_PREFIX}${key}`);
  } catch {
    // Ignore
  }
  await clearFallbackValue(key);
}

export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  await saveSecure(`provider_key_${providerId}`, apiKey);
}

export async function getProviderApiKey(providerId: string): Promise<string | null> {
  return getSecure(`provider_key_${providerId}`);
}

export async function deleteProviderApiKey(providerId: string): Promise<void> {
  await deleteSecure(`provider_key_${providerId}`);
}

export async function saveMcpToken(serverId: string, token: string): Promise<void> {
  await saveSecure(`mcp_token_${serverId}`, token);
}

export async function getMcpToken(serverId: string): Promise<string | null> {
  return getSecure(`mcp_token_${serverId}`);
}

export async function deleteMcpToken(serverId: string): Promise<void> {
  await deleteSecure(`mcp_token_${serverId}`);
}

export async function saveMcpOAuthSecret(serverId: string, value: string): Promise<void> {
  await saveSecure(`mcp_oauth_secret_${serverId}`, value);
}

export async function getMcpOAuthSecret(serverId: string): Promise<string | null> {
  return getSecure(`mcp_oauth_secret_${serverId}`);
}

export async function deleteMcpOAuthSecret(serverId: string): Promise<void> {
  await deleteSecure(`mcp_oauth_secret_${serverId}`);
}

export async function saveMcpOAuthClientSecret(serverId: string, value: string): Promise<void> {
  await saveSecure(`mcp_oauth_client_secret_${serverId}`, value);
}

export async function getMcpOAuthClientSecret(serverId: string): Promise<string | null> {
  return getSecure(`mcp_oauth_client_secret_${serverId}`);
}

export async function deleteMcpOAuthClientSecret(serverId: string): Promise<void> {
  await deleteSecure(`mcp_oauth_client_secret_${serverId}`);
}
