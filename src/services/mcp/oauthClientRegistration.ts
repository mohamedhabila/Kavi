import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { APP_DISPLAY_NAME, APP_VERSION } from '../../constants/appMetadata';
import type { McpServerConfig } from '../../types/remote';
import { getMcpOAuthClientSecret } from '../storage/SecureStorage';
import { createOAuthFetch, isSameAuthorizationServer } from './oauthDiscovery';
import { McpOAuthError, runOAuthOperation } from './oauthErrors';
import { loadMcpOAuthState, type StoredOAuthState } from './oauthState';
import { createLogger } from '../../utils/logger';

const logger = createLogger('mcp.oauthClientRegistration');

function buildClientMetadata(
  redirectUrl: string,
  metadata: AuthorizationServerMetadata,
): OAuthClientMetadata {
  const grantTypes = metadata.grant_types_supported?.includes('refresh_token')
    ? ['authorization_code', 'refresh_token']
    : ['authorization_code'];

  return {
    client_name: APP_DISPLAY_NAME,
    redirect_uris: [redirectUrl],
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    software_id: 'kavi',
    software_version: APP_VERSION,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Refuses to send a configured client secret to an authorization server it was not first
 * used with, unless the person pinned the authorization and token URLs themselves.
 *
 * The MCP server names its authorization server, so a malicious or compromised one can
 * point sign-in somewhere else and collect the secret (GHSA-6qxp-vccf-f47h). Whether that
 * change is expected is the person's call, so the secret is withheld and the error says
 * how to confirm it.
 */
function assertConfiguredSecretStaysWithIssuer(
  server: McpServerConfig,
  storedState: StoredOAuthState,
  authorizationServerUrl: string,
): void {
  const pinnedByPerson = Boolean(server.oauth?.authorizationUrl && server.oauth?.tokenUrl);
  if (
    pinnedByPerson ||
    !storedState.authorizationServerUrl ||
    isSameAuthorizationServer(storedState.authorizationServerUrl, authorizationServerUrl)
  ) {
    return;
  }
  logger.warn('Withheld a configured client secret from a changed authorization server.', {
    serverId: server.id,
    issuedBy: hostOf(storedState.authorizationServerUrl),
    nowNamed: hostOf(authorizationServerUrl),
  });
  throw new McpOAuthError(
    `This server now sends sign-in to a different provider (${hostOf(authorizationServerUrl)}) ` +
      `than the one your client ID was first used with (${hostOf(storedState.authorizationServerUrl)}). ` +
      'Your client secret was not sent there. If the change is expected, set the ' +
      "authorization and token URLs in this server's OAuth settings.",
    'configuration_required',
  );
}

/**
 * The OAuth client to sign in with at `authorizationServerUrl`.
 *
 * Stored credentials belong to the authorization server that issued them. The SDK binds
 * them in its own `auth()` flow, but its advisory leaves direct `exchangeAuthorization`
 * calls — how Kavi signs in — uncovered, so the binding is made here: a stored
 * registration is reused only at the server that issued it, and a different server gets
 * a fresh registration instead of another server's client secret.
 */
export async function resolveClientInformation(
  server: McpServerConfig,
  metadata: AuthorizationServerMetadata,
  authorizationServerUrl: string,
  redirectUrl: string,
  projectNameForProxy?: string,
): Promise<OAuthClientInformationFull> {
  const storedState = await loadMcpOAuthState(server.id);
  const issuedHere = isSameAuthorizationServer(
    storedState.authorizationServerUrl,
    authorizationServerUrl,
  );

  if (issuedHere && storedState.clientInformation?.client_id) {
    const savedRedirectUrl = storedState.clientInformation.redirect_uris?.[0];
    if (savedRedirectUrl === redirectUrl) {
      return storedState.clientInformation;
    }
  } else if (storedState.clientInformation?.client_id) {
    logger.warn('Stored OAuth client belongs to another authorization server; not reusing it.', {
      serverId: server.id,
      issuedBy: storedState.authorizationServerUrl
        ? hostOf(storedState.authorizationServerUrl)
        : 'unknown',
      nowNamed: hostOf(authorizationServerUrl),
    });
  }

  if (server.oauth?.clientId) {
    const clientSecret = server.oauth.clientSecretRef
      ? await getMcpOAuthClientSecret(server.id)
      : null;
    if (clientSecret) {
      assertConfiguredSecretStaysWithIssuer(server, storedState, authorizationServerUrl);
    }

    return {
      client_id: server.oauth.clientId,
      client_secret: clientSecret || undefined,
      redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method:
        server.oauth.tokenEndpointAuthMethod || (clientSecret ? 'client_secret_basic' : 'none'),
      scope: server.oauth.scope,
    };
  }

  if (!metadata.registration_endpoint) {
    throw new McpOAuthError(
      'This server requires an OAuth client registration. Edit this server to add a client ID and optional client secret.',
      'configuration_required',
    );
  }

  return runOAuthOperation({
    server,
    operation: 'client registration',
    authorizationServerUrl,
    projectNameForProxy,
    execute: () =>
      registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata: buildClientMetadata(redirectUrl, metadata),
        fetchFn: createOAuthFetch(server),
      }),
  });
}
