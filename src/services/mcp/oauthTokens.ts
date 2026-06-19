import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import type { McpServerConfig } from '../../types/remote';
import { createOAuthFetch, getResourceUrl } from './oauthDiscovery';
import type { StoredOAuthState, StoredOAuthTokens } from './oauthState';
import { saveMcpOAuthState } from './oauthState';

const AUTH_REFRESH_SKEW_MS = 60_000;

export function isTokenExpired(tokens: StoredOAuthTokens): boolean {
  if (!tokens.expires_in) {
    return false;
  }

  return tokens.obtainedAt + tokens.expires_in * 1000 - AUTH_REFRESH_SKEW_MS <= Date.now();
}

export async function refreshTokens(
  server: McpServerConfig,
  state: StoredOAuthState,
): Promise<StoredOAuthTokens | null> {
  if (!state.tokens?.refresh_token || !state.clientInformation || !state.authorizationServerUrl) {
    return state.tokens || null;
  }

  const refreshed = await refreshAuthorization(state.authorizationServerUrl, {
    metadata: state.metadata,
    clientInformation: state.clientInformation,
    refreshToken: state.tokens.refresh_token,
    resource: getResourceUrl(state.resourceMetadata),
    fetchFn: createOAuthFetch(server),
  }).catch(() => null);

  if (!refreshed) {
    return null;
  }

  const nextTokens: StoredOAuthTokens = {
    ...refreshed,
    refresh_token: refreshed.refresh_token || state.tokens.refresh_token,
    obtainedAt: Date.now(),
  };

  await saveMcpOAuthState(server.id, {
    ...state,
    tokens: nextTokens,
  });

  return nextTokens;
}
