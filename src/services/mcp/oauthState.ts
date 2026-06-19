import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthProtectedResourceMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  deleteMcpOAuthClientSecret,
  deleteMcpOAuthSecret,
  getMcpOAuthSecret,
  saveMcpOAuthSecret,
} from '../storage/SecureStorage';

export type StoredOAuthTokens = OAuthTokens & {
  obtainedAt: number;
};

export type PendingOAuthFlow = {
  state: string;
  codeVerifier: string;
  redirectUrl: string;
  returnUrl: string;
  projectNameForProxy: string;
};

export type StoredOAuthState = {
  authorizationServerUrl?: string;
  metadata?: AuthorizationServerMetadata;
  resourceMetadata?: OAuthProtectedResourceMetadata;
  clientInformation?: OAuthClientInformationFull;
  tokens?: StoredOAuthTokens;
  pending?: PendingOAuthFlow;
};

function parseMaybeJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function loadMcpOAuthState(serverId: string): Promise<StoredOAuthState> {
  return parseMaybeJson<StoredOAuthState>(await getMcpOAuthSecret(serverId)) || {};
}

export async function saveMcpOAuthState(
  serverId: string,
  state: StoredOAuthState,
): Promise<void> {
  await saveMcpOAuthSecret(serverId, JSON.stringify(state));
}

export async function clearMcpOAuthState(serverId: string): Promise<void> {
  await Promise.all([deleteMcpOAuthSecret(serverId), deleteMcpOAuthClientSecret(serverId)]);
}
