import type {
  McpAuthMode,
  McpCapabilityMetadata,
  McpServerConfig,
  McpTrustMetadata,
} from '../../types';

function hasConfiguredHeaders(headers?: Record<string, string>): boolean {
  return Object.values(headers || {}).some((value) => String(value).trim().length > 0);
}

function countConfiguredHeaders(headers?: Record<string, string>): number {
  return Object.values(headers || {}).filter((value) => String(value).trim().length > 0).length;
}

export function inferMcpServerAuthMode(
  server: Pick<McpServerConfig, 'oauth' | 'token' | 'tokenRef' | 'headers'>,
): McpAuthMode {
  const hasOAuth = Boolean(server.oauth && Object.values(server.oauth).some(Boolean));
  const hasToken = Boolean(server.token?.trim() || server.tokenRef?.trim());
  const hasHeaders = hasConfiguredHeaders(server.headers);

  if (hasOAuth && (hasToken || hasHeaders)) {
    return 'mixed';
  }

  if (hasOAuth) {
    return 'oauth';
  }

  if (hasToken || hasHeaders) {
    return 'header';
  }

  return 'none';
}

export function normalizeMcpTrustMetadata(server: McpServerConfig): McpTrustMetadata {
  return server.trust || { source: 'manual' };
}

export function summarizeMcpServerCapabilities(server: McpServerConfig): McpCapabilityMetadata {
  if (server.capabilities) {
    return {
      transport: server.capabilities.transport || server.transport || 'auto',
      authMode: server.capabilities.authMode || inferMcpServerAuthMode(server),
      requiresConfiguration: server.capabilities.requiresConfiguration,
      requiresSecrets: server.capabilities.requiresSecrets,
      inputCount: server.capabilities.inputCount,
    };
  }

  const authMode = inferMcpServerAuthMode(server);
  const headerCount = countConfiguredHeaders(server.headers);
  const tokenCount = server.token?.trim() || server.tokenRef?.trim() ? 1 : 0;
  const oauthFieldCount = server.oauth
    ? [
        server.oauth.clientId,
        server.oauth.clientSecretRef,
        server.oauth.authorizationUrl,
        server.oauth.tokenUrl,
        server.oauth.scope,
      ].filter(Boolean).length
    : 0;
  const inputCount = headerCount + tokenCount + oauthFieldCount;

  return {
    transport: server.transport || 'auto',
    authMode,
    requiresConfiguration: inputCount > 0,
    requiresSecrets: Boolean(tokenCount || headerCount || server.oauth?.clientSecretRef),
    inputCount,
  };
}

export function normalizeMcpServerConfigMetadata(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    trust: normalizeMcpTrustMetadata(server),
    capabilities: summarizeMcpServerCapabilities(server),
  };
}
