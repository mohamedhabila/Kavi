import 'react-native-get-random-values';

import * as WebBrowser from 'expo-web-browser';
import { exchangeAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import type { McpServerConfig } from '../../types/remote';
import { resolveClientInformation } from './oauthClientRegistration';
import { createOAuthFetch, discoverServerInfo, getResourceUrl } from './oauthDiscovery';
import {
  appendProxyConfigurationHint,
  McpOAuthError,
  runOAuthOperation,
} from './oauthErrors';
import { buildAuthorizationRequest, randomBase64Url } from './oauthPkce';
import {
  getDirectRedirectUrl,
  getProjectNameForProxy,
  getRedirectUrl,
  getReturnUrl,
  getStartUrl,
  shouldUseProxy,
} from './oauthRedirects';
import {
  clearMcpOAuthState,
  loadMcpOAuthState,
  saveMcpOAuthState,
} from './oauthState';
import { isTokenExpired, refreshTokens } from './oauthTokens';

export { McpOAuthError };

export async function getMcpOAuthHeaders(server: McpServerConfig): Promise<Record<string, string>> {
  const state = await loadMcpOAuthState(server.id);
  if (!state.tokens) {
    return {};
  }

  const tokens = isTokenExpired(state.tokens) ? await refreshTokens(server, state) : state.tokens;

  if (!tokens?.access_token) {
    return {};
  }

  return {
    Authorization: `Bearer ${tokens.access_token}`,
  };
}

export async function hasStoredMcpOAuth(serverId: string): Promise<boolean> {
  const state = await loadMcpOAuthState(serverId);
  return Boolean(
    state.tokens?.access_token || state.pending?.state || state.clientInformation?.client_id,
  );
}

export async function clearMcpOAuth(serverId: string): Promise<void> {
  await clearMcpOAuthState(serverId);
}

export async function authenticateMcpServer(server: McpServerConfig): Promise<void> {
  const useProxy = shouldUseProxy(server);
  const projectNameForProxy = getProjectNameForProxy(server);

  const redirectUrl = useProxy
    ? getRedirectUrl(projectNameForProxy)
    : getDirectRedirectUrl(server.id);
  const returnUrl = useProxy ? getReturnUrl(server.id) : redirectUrl;

  const { authorizationServerUrl, metadata, resourceMetadata } = await discoverServerInfo(server);
  const clientInformation = await resolveClientInformation(
    server,
    metadata,
    authorizationServerUrl,
    redirectUrl,
    projectNameForProxy,
  );
  const scope =
    server.oauth?.scope ||
    clientInformation.scope ||
    resourceMetadata?.scopes_supported?.join(' ') ||
    metadata.scopes_supported?.join(' ');
  const state = randomBase64Url();
  const resource = getResourceUrl(resourceMetadata);
  const { authorizationUrl, codeVerifier } = buildAuthorizationRequest({
    metadata,
    clientInformation,
    redirectUrl,
    scope,
    state,
    resource,
  });

  await saveMcpOAuthState(server.id, {
    authorizationServerUrl,
    metadata,
    resourceMetadata,
    clientInformation,
    pending: {
      state,
      codeVerifier,
      redirectUrl,
      returnUrl,
      projectNameForProxy,
    },
  });

  const browserUrl = useProxy
    ? getStartUrl(authorizationUrl.toString(), returnUrl, projectNameForProxy)
    : authorizationUrl.toString();
  const result = await WebBrowser.openAuthSessionAsync(browserUrl, returnUrl);
  const redirectResult = result as { type: string; url?: string };

  if (redirectResult.type !== 'success' || !redirectResult.url) {
    throw new McpOAuthError(
      'Authentication was cancelled before the server returned an authorization code.',
      'cancelled',
    );
  }

  const callbackUrl = new URL(redirectResult.url);
  if (callbackUrl.searchParams.get('state') !== state) {
    throw new McpOAuthError(
      'OAuth state validation failed. Start authentication again.',
      'auth_failed',
    );
  }

  const code = callbackUrl.searchParams.get('code');
  const oauthError = callbackUrl.searchParams.get('error');
  if (oauthError) {
    const description = callbackUrl.searchParams.get('error_description');
    throw new McpOAuthError(
      appendProxyConfigurationHint(description || oauthError, projectNameForProxy),
      'auth_failed',
    );
  }
  if (!code) {
    throw new McpOAuthError(
      'No authorization code was returned by the OAuth provider.',
      'auth_failed',
    );
  }

  const tokens = await runOAuthOperation({
    server,
    operation: 'token exchange',
    authorizationServerUrl,
    projectNameForProxy,
    execute: () =>
      exchangeAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation,
        authorizationCode: code,
        codeVerifier,
        redirectUri: redirectUrl,
        resource,
        fetchFn: createOAuthFetch(server),
      }),
  });

  await saveMcpOAuthState(server.id, {
    authorizationServerUrl,
    metadata,
    resourceMetadata,
    clientInformation,
    tokens: {
      ...tokens,
      obtainedAt: Date.now(),
    },
  });
}
