import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { McpOAuthConfig, McpServerConfig } from '../../types/remote';

const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

export type OAuthServerInfo = {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata;
  resourceMetadata?: OAuthProtectedResourceMetadata;
};

function stripToOrigin(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function buildFallbackMetadata(
  authorizationServerUrl: string,
  oauth?: McpOAuthConfig,
): AuthorizationServerMetadata {
  const baseUrl = stripToOrigin(authorizationServerUrl);
  return {
    issuer: baseUrl,
    authorization_endpoint: oauth?.authorizationUrl || new URL('/authorize', baseUrl).toString(),
    token_endpoint: oauth?.tokenUrl || new URL('/token', baseUrl).toString(),
    registration_endpoint: new URL('/register', baseUrl).toString(),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: oauth?.clientId
      ? [oauth.tokenEndpointAuthMethod || (oauth.clientSecretRef ? 'client_secret_basic' : 'none')]
      : ['none', 'client_secret_basic', 'client_secret_post'],
  };
}

function shouldFilterOAuthHeader(name: string): boolean {
  return /^(authorization|cookie)$/i.test(name);
}

export function createOAuthFetch(server: McpServerConfig) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers || {});

    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    for (const [key, value] of Object.entries(server.headers || {})) {
      if (!shouldFilterOAuthHeader(key)) {
        headers.set(key, value);
      }
    }

    return fetch(input, {
      ...init,
      headers,
    });
  };
}

export async function discoverServerInfo(server: McpServerConfig): Promise<OAuthServerInfo> {
  const oauthConfig = server.oauth;

  if (oauthConfig?.authorizationUrl && oauthConfig.tokenUrl) {
    const authorizationServerUrl = stripToOrigin(oauthConfig.authorizationUrl);
    return {
      authorizationServerUrl,
      metadata: buildFallbackMetadata(authorizationServerUrl, oauthConfig),
    };
  }

  const fetchFn = createOAuthFetch(server);
  const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
    server.url,
    { protocolVersion: DEFAULT_PROTOCOL_VERSION },
    fetchFn,
  ).catch(() => undefined);

  const authorizationServerUrl =
    resourceMetadata?.authorization_servers?.[0] || stripToOrigin(server.url);

  const metadata = await discoverAuthorizationServerMetadata(authorizationServerUrl, {
    fetchFn,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
  }).catch(() => undefined);

  return {
    authorizationServerUrl,
    metadata: metadata || buildFallbackMetadata(authorizationServerUrl, oauthConfig),
    resourceMetadata,
  };
}

export function getResourceUrl(resourceMetadata?: OAuthProtectedResourceMetadata): URL | undefined {
  const value = resourceMetadata?.resource;
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
