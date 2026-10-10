// ---------------------------------------------------------------------------
// Tests — MCP OAuth credentials stay with the authorization server that issued them
// ---------------------------------------------------------------------------
// GHSA-6qxp-vccf-f47h: an MCP server can name a different authorization server, and a
// client that does not tie its stored credentials to the server that issued them sends
// them there. The SDK's fix covers its own `auth()` flow but not direct calls to
// `exchangeAuthorization`, which is how Kavi signs in, so the binding lives here.

jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getMcpOAuthSecret: jest.fn().mockResolvedValue(null),
  saveMcpOAuthSecret: jest.fn().mockResolvedValue(undefined),
  getMcpOAuthClientSecret: jest.fn().mockResolvedValue(null),
  deleteMcpOAuthSecret: jest.fn().mockResolvedValue(undefined),
  deleteMcpOAuthClientSecret: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverAuthorizationServerMetadata: jest.fn(),
  discoverOAuthProtectedResourceMetadata: jest.fn(),
  exchangeAuthorization: jest.fn(),
  refreshAuthorization: jest.fn(),
  registerClient: jest.fn(),
}));

import { registerClient } from '@modelcontextprotocol/sdk/client/auth.js';
import type { AuthorizationServerMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { resolveClientInformation } from '../../../src/services/mcp/oauthClientRegistration';
import { isSameAuthorizationServer } from '../../../src/services/mcp/oauthDiscovery';
import { McpOAuthError } from '../../../src/services/mcp/oauthErrors';
import {
  getMcpOAuthClientSecret,
  getMcpOAuthSecret,
} from '../../../src/services/storage/SecureStorage';
import type { McpServerConfig } from '../../../src/types/remote';

const mockRegister = registerClient as jest.Mock;
const mockGetState = getMcpOAuthSecret as jest.Mock;
const mockGetClientSecret = getMcpOAuthClientSecret as jest.Mock;

const REDIRECT = 'kavi://mcp-auth/server-1';
const ORIGINAL_AS = 'https://auth.example.com/';
const OTHER_AS = 'https://login.attacker.example/';

function metadataFor(base: string): AuthorizationServerMetadata {
  return {
    issuer: base,
    authorization_endpoint: `${base}authorize`,
    token_endpoint: `${base}token`,
    registration_endpoint: `${base}register`,
    response_types_supported: ['code'],
  };
}

function storedSignIn(authorizationServerUrl: string) {
  mockGetState.mockResolvedValue(
    JSON.stringify({
      authorizationServerUrl,
      clientInformation: {
        client_id: 'registered-at-original',
        client_secret: 'issued-by-original',
        redirect_uris: [REDIRECT],
      },
    }),
  );
}

const server: McpServerConfig = {
  id: 'server-1',
  name: 'Notes',
  url: 'https://mcp.example.com/mcp',
} as McpServerConfig;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetState.mockResolvedValue(null);
  mockGetClientSecret.mockResolvedValue(null);
  mockRegister.mockResolvedValue({
    client_id: 'registered-fresh',
    redirect_uris: [REDIRECT],
  });
});

describe('a stored client registration', () => {
  it('is reused at the authorization server that issued it', async () => {
    storedSignIn(ORIGINAL_AS);

    const client = await resolveClientInformation(
      server,
      metadataFor(ORIGINAL_AS),
      'https://auth.example.com',
      REDIRECT,
    );

    expect(client.client_id).toBe('registered-at-original');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('is never sent to a different authorization server; a fresh one is registered there', async () => {
    storedSignIn(ORIGINAL_AS);

    const client = await resolveClientInformation(server, metadataFor(OTHER_AS), OTHER_AS, REDIRECT);

    expect(client.client_id).toBe('registered-fresh');
    expect(client).not.toHaveProperty('client_secret', 'issued-by-original');
    expect(mockRegister).toHaveBeenCalledWith(OTHER_AS, expect.anything());
  });
});

describe('a client secret the person configured', () => {
  const configured: McpServerConfig = {
    ...server,
    oauth: { clientId: 'my-client', clientSecretRef: 'secure' },
  } as McpServerConfig;

  beforeEach(() => {
    mockGetClientSecret.mockResolvedValue('configured-secret');
  });

  it('is used at the authorization server it was first signed in with', async () => {
    storedSignIn(ORIGINAL_AS);

    const client = await resolveClientInformation(
      configured,
      metadataFor(ORIGINAL_AS),
      ORIGINAL_AS,
      'kavi://mcp-auth/other-redirect',
    );

    expect(client).toMatchObject({ client_id: 'my-client', client_secret: 'configured-secret' });
  });

  it('is withheld when the server starts naming a different authorization server', async () => {
    storedSignIn(ORIGINAL_AS);

    const attempt = resolveClientInformation(
      configured,
      metadataFor(OTHER_AS),
      OTHER_AS,
      'kavi://mcp-auth/other-redirect',
    );

    await expect(attempt).rejects.toBeInstanceOf(McpOAuthError);
    await expect(attempt).rejects.toMatchObject({ code: 'configuration_required' });
    await expect(attempt).rejects.toThrow('login.attacker.example');
  });

  it('follows authorization URLs the person set explicitly', async () => {
    storedSignIn(ORIGINAL_AS);
    const pinned = {
      ...configured,
      oauth: {
        ...configured.oauth,
        authorizationUrl: `${OTHER_AS}authorize`,
        tokenUrl: `${OTHER_AS}token`,
      },
    } as McpServerConfig;

    const client = await resolveClientInformation(
      pinned,
      metadataFor(OTHER_AS),
      OTHER_AS,
      'kavi://mcp-auth/other-redirect',
    );

    expect(client.client_secret).toBe('configured-secret');
  });

  it('is used on a first sign-in, when nothing was issued before', async () => {
    const client = await resolveClientInformation(
      configured,
      metadataFor(OTHER_AS),
      OTHER_AS,
      REDIRECT,
    );

    expect(client.client_secret).toBe('configured-secret');
  });
});

describe('comparing authorization servers', () => {
  it('ignores a trailing slash, query and fragment', () => {
    expect(isSameAuthorizationServer('https://auth.example.com/', 'https://auth.example.com')).toBe(
      true,
    );
    expect(
      isSameAuthorizationServer('https://auth.example.com/tenant/', 'https://auth.example.com/tenant#x'),
    ).toBe(true);
  });

  it('tells apart hosts, schemes and tenant paths', () => {
    expect(isSameAuthorizationServer(ORIGINAL_AS, OTHER_AS)).toBe(false);
    expect(isSameAuthorizationServer('http://auth.example.com', 'https://auth.example.com')).toBe(
      false,
    );
    expect(
      isSameAuthorizationServer('https://auth.example.com/a', 'https://auth.example.com/b'),
    ).toBe(false);
  });

  it('treats a missing or unparseable URL as different', () => {
    expect(isSameAuthorizationServer(undefined, ORIGINAL_AS)).toBe(false);
    expect(isSameAuthorizationServer('not a url', ORIGINAL_AS)).toBe(false);
  });
});
