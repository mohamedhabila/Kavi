import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { APP_DISPLAY_NAME, APP_VERSION } from '../../constants/appMetadata';
import type { McpServerConfig } from '../../types/remote';
import { getMcpOAuthClientSecret } from '../storage/SecureStorage';
import { createOAuthFetch } from './oauthDiscovery';
import { McpOAuthError, runOAuthOperation } from './oauthErrors';
import { loadMcpOAuthState } from './oauthState';

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

export async function resolveClientInformation(
  server: McpServerConfig,
  metadata: AuthorizationServerMetadata,
  authorizationServerUrl: string,
  redirectUrl: string,
  projectNameForProxy?: string,
): Promise<OAuthClientInformationFull> {
  const storedState = await loadMcpOAuthState(server.id);

  if (storedState.clientInformation?.client_id) {
    const savedRedirectUrl = storedState.clientInformation.redirect_uris?.[0];
    if (savedRedirectUrl === redirectUrl) {
      return storedState.clientInformation;
    }
  }

  if (server.oauth?.clientId) {
    const clientSecret = server.oauth.clientSecretRef
      ? await getMcpOAuthClientSecret(server.id)
      : null;

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
