jest.mock('expo-auth-session', () => ({
  getDefaultReturnUrl: jest.fn(() => 'kavi://mcp-auth/server-1'),
  makeRedirectUri: jest.fn(
    ({ scheme, path }: { scheme: string; path: string }) => `${scheme}://${path}`,
  ),
}));

jest.mock('expo-constants', () => ({
  expoConfig: {
    slug: 'kavi',
    owner: 'test-owner',
  },
}));

const mockSaveMcpOAuthSecret = jest.fn().mockResolvedValue(undefined);
const mockGetMcpOAuthSecret = jest.fn().mockResolvedValue(null);
const mockDeleteMcpOAuthSecret = jest.fn().mockResolvedValue(undefined);
const mockDeleteMcpOAuthClientSecret = jest.fn().mockResolvedValue(undefined);
const mockGetMcpOAuthClientSecret = jest.fn().mockResolvedValue(null);

jest.mock('../../src/services/storage/SecureStorage', () => ({
  saveMcpOAuthSecret: (...args: unknown[]) => mockSaveMcpOAuthSecret(...args),
  getMcpOAuthSecret: (...args: unknown[]) => mockGetMcpOAuthSecret(...args),
  deleteMcpOAuthSecret: (...args: unknown[]) => mockDeleteMcpOAuthSecret(...args),
  deleteMcpOAuthClientSecret: (...args: unknown[]) => mockDeleteMcpOAuthClientSecret(...args),
  getMcpOAuthClientSecret: (...args: unknown[]) => mockGetMcpOAuthClientSecret(...args),
}));

import * as WebBrowser from 'expo-web-browser';
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { authenticateMcpServer, McpOAuthError } from '../../src/services/mcp/oauth';

describe('MCP OAuth service', () => {
  const originalCrypto = global.crypto;
  const expoConstants = jest.requireMock('expo-constants') as {
    expoConfig: { owner?: string; slug?: string };
  };
  const mockRegisterClient = registerClient as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    expoConstants.expoConfig.owner = 'test-owner';
    expoConstants.expoConfig.slug = 'kavi';

    Object.defineProperty(global, 'crypto', {
      value: {
        getRandomValues: (array: Uint8Array) => {
          for (let index = 0; index < array.length; index += 1) {
            array[index] = (index * 13 + 17) % 256;
          }
          return array;
        },
        subtle: undefined,
      },
      configurable: true,
    });

    (discoverOAuthProtectedResourceMetadata as jest.Mock).mockResolvedValue({
      resource: 'https://mcp.linear.app/mcp',
      authorization_servers: ['https://linear.app'],
      scopes_supported: ['read'],
    });
    (discoverAuthorizationServerMetadata as jest.Mock).mockResolvedValue({
      issuer: 'https://linear.app',
      authorization_endpoint: 'https://linear.app/oauth/authorize',
      token_endpoint: 'https://linear.app/oauth/token',
      registration_endpoint: 'https://linear.app/oauth/register',
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
    mockRegisterClient.mockResolvedValue({
      client_id: 'generated-client-id',
      redirect_uris: ['https://auth.expo.io/@test-owner/kavi'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    (exchangeAuthorization as jest.Mock).mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockImplementation(
      async (browserUrl: string) => {
        // Direct flow: the browserUrl IS the authorization URL
        // Proxy flow: the browserUrl wraps the authUrl as a query param
        let state: string | null = null;
        const parsed = new URL(browserUrl);
        const authUrlParam = parsed.searchParams.get('authUrl');
        if (authUrlParam) {
          // Proxy flow
          state = new URL(authUrlParam).searchParams.get('state');
        } else {
          // Direct flow — the URL itself has the state param
          state = parsed.searchParams.get('state');
        }
        return {
          type: 'success',
          url: `kavi://mcp-auth/server-1?code=auth-code&state=${encodeURIComponent(state || '')}`,
        };
      },
    );
  });

  afterAll(() => {
    Object.defineProperty(global, 'crypto', {
      value: originalCrypto,
      configurable: true,
    });
  });

  it('authenticates without crypto.subtle.digest by building PKCE locally', async () => {
    await authenticateMcpServer({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {},
      oauth: {
        clientId: 'linear-mobile-client',
      },
    } as any);

    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledTimes(1);

    const [startUrl, returnUrl] = (WebBrowser.openAuthSessionAsync as jest.Mock).mock.calls[0];
    expect(returnUrl).toBe('kavi://mcp-auth/server-1');

    const authUrl = new URL(new URL(startUrl).searchParams.get('authUrl') || '');
    expect(authUrl.origin).toBe('https://linear.app');
    expect(authUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('resource')).toBe('https://mcp.linear.app/mcp');

    expect(exchangeAuthorization).toHaveBeenCalledWith(
      'https://linear.app',
      expect.objectContaining({
        authorizationCode: 'auth-code',
        redirectUri: 'https://auth.expo.io/@test-owner/kavi',
        codeVerifier: expect.any(String),
      }),
    );

    expect(mockSaveMcpOAuthSecret).toHaveBeenCalledTimes(2);
  });

  it('uses direct custom-scheme redirect when no owner is configured', async () => {
    expoConstants.expoConfig.owner = undefined;

    await authenticateMcpServer({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {},
      oauth: {
        clientId: 'linear-mobile-client',
      },
    } as any);

    // With no owner, the proxy is bypassed — direct custom scheme redirect
    expect(exchangeAuthorization).toHaveBeenCalledWith(
      'https://linear.app',
      expect.objectContaining({
        redirectUri: 'kavi://mcp-auth/server-1',
      }),
    );
  });

  it('normalizes non-JSON registration failures into a configuration error', async () => {
    mockRegisterClient.mockRejectedValueOnce(
      new Error(
        'HTTP 403: Invalid OAuth error response: SyntaxError: JSON Parse error: Unexpected character: F. Raw body: Forbidden',
      ),
    );

    const error = await authenticateMcpServer({
      id: 'server-2',
      name: 'Restricted OAuth MCP',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://oauth.example.com/mcp',
      headers: {},
    } as any).catch((authError: unknown) => authError);

    expect(error).toBeInstanceOf(McpOAuthError);
    expect((error as McpOAuthError).code).toBe('configuration_required');
    expect((error as McpOAuthError).message).toContain('automatic OAuth client registration');
    expect((error as McpOAuthError).message).toContain('add a client ID');
    expect((error as McpOAuthError).message).not.toContain('Invalid OAuth error response');

    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('surfaces allow-listed client restrictions without leaking the SDK parse error', async () => {
    (discoverOAuthProtectedResourceMetadata as jest.Mock).mockResolvedValueOnce({
      resource: 'https://mcp.restricted.example.com/mcp',
      authorization_servers: ['https://auth.restricted.example.com'],
      scopes_supported: ['mcp:connect'],
    });
    (discoverAuthorizationServerMetadata as jest.Mock).mockResolvedValueOnce({
      issuer: 'https://auth.restricted.example.com',
      authorization_endpoint: 'https://auth.restricted.example.com/oauth/authorize',
      token_endpoint: 'https://auth.restricted.example.com/oauth/token',
      registration_endpoint: 'https://auth.restricted.example.com/oauth/register',
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
    mockRegisterClient.mockRejectedValueOnce(
      new Error(
        'HTTP 403: Invalid OAuth error response: SyntaxError: JSON Parse error: Unexpected character: F. Raw body: Forbidden',
      ),
    );

    await authenticateMcpServer({
      id: 'restricted-remote',
      name: 'Restricted Hosted MCP',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.restricted.example.com/mcp',
      headers: {},
    } as any).catch((error: unknown) => {
      expect(error).toBeInstanceOf(McpOAuthError);
      expect((error as McpOAuthError).code).toBe('configuration_required');
      expect((error as McpOAuthError).message).toContain('allow-listed OAuth clients');
      expect((error as McpOAuthError).message).not.toContain('Invalid OAuth error response');
    });

    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('normalizes non-JSON token exchange failures into a user-facing auth error', async () => {
    (exchangeAuthorization as jest.Mock).mockRejectedValueOnce(
      new Error(
        'HTTP 403: Invalid OAuth error response: SyntaxError: JSON Parse error: Unexpected character: F. Raw body: Forbidden',
      ),
    );

    await authenticateMcpServer({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {},
      oauth: {
        clientId: 'linear-mobile-client',
      },
    } as any).catch((error: unknown) => {
      expect(error).toBeInstanceOf(McpOAuthError);
      expect((error as McpOAuthError).code).toBe('auth_failed');
      expect((error as McpOAuthError).message).toContain('authorization exchange');
      expect((error as McpOAuthError).message).not.toContain('Invalid OAuth error response');
    });
  });
});
