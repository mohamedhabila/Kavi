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
  refreshAuthorization,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  authenticateMcpServer,
  clearMcpOAuth,
  getMcpOAuthHeaders,
  hasStoredMcpOAuth,
  McpOAuthError,
} from '../../src/services/mcp/oauth';

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

  it('returns no headers when no OAuth session is stored', async () => {
    await expect(
      getMcpOAuthHeaders({
        id: 'server-1',
        name: 'Linear',
        type: 'remote',
        transport: 'streamable-http',
        url: 'https://mcp.linear.app/mcp',
        headers: {},
      } as any),
    ).resolves.toEqual({});
  });

  it('returns stored bearer headers without refreshing valid tokens', async () => {
    mockGetMcpOAuthSecret.mockResolvedValueOnce(
      JSON.stringify({
        tokens: {
          access_token: 'stored-access-token',
          refresh_token: 'stored-refresh-token',
          expires_in: 3600,
          obtainedAt: Date.now(),
        },
      }),
    );

    const headers = await getMcpOAuthHeaders({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {},
    } as any);

    expect(headers).toEqual({ Authorization: 'Bearer stored-access-token' });
    expect(refreshAuthorization).not.toHaveBeenCalled();
  });

  it('drops expired stored bearer headers when refresh fails', async () => {
    mockGetMcpOAuthSecret.mockResolvedValueOnce(
      JSON.stringify({
        authorizationServerUrl: 'https://linear.app',
        clientInformation: {
          client_id: 'linear-mobile-client',
        },
        tokens: {
          access_token: 'expired-access-token',
          refresh_token: 'stored-refresh-token',
          expires_in: 1,
          obtainedAt: Date.now() - 10_000,
        },
      }),
    );
    (refreshAuthorization as jest.Mock).mockRejectedValueOnce(new Error('session expired'));

    const headers = await getMcpOAuthHeaders({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {},
    } as any);

    expect(headers).toEqual({});
    expect(mockSaveMcpOAuthSecret).not.toHaveBeenCalled();
  });

  it('refreshes expired stored bearer tokens and preserves the refresh token fallback', async () => {
    mockGetMcpOAuthSecret.mockResolvedValueOnce(
      JSON.stringify({
        authorizationServerUrl: 'https://linear.app',
        metadata: {
          token_endpoint: 'https://linear.app/oauth/token',
        },
        resourceMetadata: {
          resource: 'https://mcp.linear.app/mcp',
        },
        clientInformation: {
          client_id: 'linear-mobile-client',
        },
        tokens: {
          access_token: 'expired-access-token',
          refresh_token: 'stored-refresh-token',
          expires_in: 1,
          obtainedAt: Date.now() - 10_000,
        },
      }),
    );
    (refreshAuthorization as jest.Mock).mockResolvedValueOnce({
      access_token: 'refreshed-access-token',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    const headers = await getMcpOAuthHeaders({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {
        'X-MCP-Trace': 'trace-id',
        Authorization: 'Bearer static-token',
      },
    } as any);

    expect(headers).toEqual({ Authorization: 'Bearer refreshed-access-token' });
    expect(refreshAuthorization).toHaveBeenCalledWith(
      'https://linear.app',
      expect.objectContaining({
        refreshToken: 'stored-refresh-token',
        resource: new URL('https://mcp.linear.app/mcp'),
      }),
    );
    const refreshOptions = (refreshAuthorization as jest.Mock).mock.calls[0][1];
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
    Object.defineProperty(global, 'fetch', {
      value: fetchMock,
      configurable: true,
    });
    try {
      await refreshOptions.fetchFn('https://linear.app/oauth/token');
    } finally {
      Object.defineProperty(global, 'fetch', {
        value: originalFetch,
        configurable: true,
      });
    }
    const forwardedHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(forwardedHeaders.get('X-MCP-Trace')).toBe('trace-id');
    expect(forwardedHeaders.has('Authorization')).toBe(false);

    const savedState = JSON.parse(mockSaveMcpOAuthSecret.mock.calls[0][1]);
    expect(savedState.tokens).toEqual(
      expect.objectContaining({
        access_token: 'refreshed-access-token',
        refresh_token: 'stored-refresh-token',
        obtainedAt: expect.any(Number),
      }),
    );
  });

  it('reuses stored OAuth client information when the redirect URL still matches', async () => {
    mockGetMcpOAuthSecret.mockResolvedValueOnce(
      JSON.stringify({
        clientInformation: {
          client_id: 'stored-client-id',
          redirect_uris: ['https://auth.expo.io/@test-owner/kavi'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      }),
    );

    await authenticateMcpServer({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {},
    } as any);

    expect(mockRegisterClient).not.toHaveBeenCalled();
    expect(exchangeAuthorization).toHaveBeenCalledWith(
      'https://linear.app',
      expect.objectContaining({
        clientInformation: expect.objectContaining({
          client_id: 'stored-client-id',
        }),
      }),
    );
  });

  it('uses explicit OAuth endpoints without metadata discovery', async () => {
    await authenticateMcpServer({
      id: 'server-1',
      name: 'Configured OAuth MCP',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://configured.example.com/mcp',
      headers: {},
      oauth: {
        clientId: 'configured-client',
        authorizationUrl: 'https://auth.configured.example.com/oauth/authorize',
        tokenUrl: 'https://auth.configured.example.com/oauth/token',
      },
    } as any);

    expect(discoverOAuthProtectedResourceMetadata).not.toHaveBeenCalled();
    expect(discoverAuthorizationServerMetadata).not.toHaveBeenCalled();
    expect(exchangeAuthorization).toHaveBeenCalledWith(
      'https://auth.configured.example.com/',
      expect.objectContaining({
        metadata: expect.objectContaining({
          authorization_endpoint: 'https://auth.configured.example.com/oauth/authorize',
          token_endpoint: 'https://auth.configured.example.com/oauth/token',
        }),
      }),
    );
  });

  it('requires configured client information when registration metadata is missing', async () => {
    (discoverAuthorizationServerMetadata as jest.Mock).mockResolvedValueOnce({
      issuer: 'https://linear.app',
      authorization_endpoint: 'https://linear.app/oauth/authorize',
      token_endpoint: 'https://linear.app/oauth/token',
      grant_types_supported: ['authorization_code'],
    });

    await authenticateMcpServer({
      id: 'server-1',
      name: 'Linear',
      type: 'remote',
      transport: 'streamable-http',
      url: 'https://mcp.linear.app/mcp',
      headers: {},
    } as any).catch((error: unknown) => {
      expect(error).toBeInstanceOf(McpOAuthError);
      expect((error as McpOAuthError).code).toBe('configuration_required');
      expect((error as McpOAuthError).message).toContain('add a client ID');
    });

    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('adds the proxy project hint when an anonymous direct callback reports a redirect error', async () => {
    expoConstants.expoConfig.owner = undefined;
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockImplementationOnce(async (browserUrl: string) => {
      const state = new URL(browserUrl).searchParams.get('state') || '';
      return {
        type: 'success',
        url: `kavi://mcp-auth/server-1?error=invalid_request&error_description=${encodeURIComponent(
          'redirect_uri blocked',
        )}&state=${encodeURIComponent(state)}`,
      };
    });

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
      expect((error as McpOAuthError).message).toContain('OAuth Proxy Project Name');
    });
  });

  it('reports invalid stored OAuth state as empty', async () => {
    mockGetMcpOAuthSecret.mockResolvedValueOnce('{not valid JSON');

    await expect(hasStoredMcpOAuth('server-1')).resolves.toBe(false);
  });

  it('reports and clears stored OAuth state', async () => {
    mockGetMcpOAuthSecret.mockResolvedValueOnce(
      JSON.stringify({
        pending: {
          state: 'pending-state',
        },
      }),
    );

    await expect(hasStoredMcpOAuth('server-1')).resolves.toBe(true);

    await clearMcpOAuth('server-1');

    expect(mockDeleteMcpOAuthSecret).toHaveBeenCalledWith('server-1');
    expect(mockDeleteMcpOAuthClientSecret).toHaveBeenCalledWith('server-1');
  });
});
