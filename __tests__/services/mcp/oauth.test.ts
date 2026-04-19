// ---------------------------------------------------------------------------
// Tests — MCP OAuth (redirect_uri direct flow)
// ---------------------------------------------------------------------------
// Validates that when no Expo owner is configured (anonymous project),
// the OAuth flow uses a direct custom-scheme redirect instead of the
// Expo auth proxy.

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      slug: 'kavi',
      // No owner → anonymous fallback
    },
  },
}));

jest.mock('expo-auth-session', () => ({
  getDefaultReturnUrl: jest.fn((path: string) => `exp://mocked/${path}`),
  makeRedirectUri: jest.fn(
    ({ scheme, path }: { scheme: string; path: string }) => `${scheme}://${path}`,
  ),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

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

import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { authenticateMcpServer, McpOAuthError } from '../../../src/services/mcp/oauth';

const mockOpenAuth = WebBrowser.openAuthSessionAsync as jest.Mock;
const mockDiscover = discoverAuthorizationServerMetadata as jest.Mock;
const mockDiscoverResource = discoverOAuthProtectedResourceMetadata as jest.Mock;
const mockRegister = registerClient as jest.Mock;

describe('MCP OAuth — direct redirect for anonymous projects', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockDiscoverResource.mockRejectedValue(new Error('not found'));
    mockDiscover.mockResolvedValue({
      issuer: 'https://auth.example.com/',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      registration_endpoint: 'https://auth.example.com/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
    });
    mockRegister.mockResolvedValue({
      client_id: 'test-client-id',
      redirect_uris: ['kavi://mcp-auth/server-1'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('uses direct redirect URL (custom scheme) when no Expo owner is set', async () => {
    // Simulate user cancelling the auth flow
    mockOpenAuth.mockResolvedValue({ type: 'cancel' });

    const server = {
      id: 'server-1',
      name: 'Test MCP',
      url: 'https://mcp.example.com',
      transport: 'streamable-http' as const,
    };

    await expect(authenticateMcpServer(server)).rejects.toThrow(McpOAuthError);

    // The key assertion: openAuthSessionAsync should be called with the
    // authorization URL directly (not wrapped in auth.expo.io proxy)
    expect(mockOpenAuth).toHaveBeenCalledTimes(1);
    const [browserUrl, returnUrl] = mockOpenAuth.mock.calls[0];

    // Should NOT contain auth.expo.io (proxy bypassed)
    expect(browserUrl).not.toContain('auth.expo.io');
    // Should be the direct authorization URL
    expect(browserUrl).toContain('auth.example.com/authorize');

    // Return URL should be the custom scheme redirect
    expect(returnUrl).toContain('kavi://');
  });

  it('uses makeRedirectUri with custom scheme for direct flow', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'cancel' });

    const server = {
      id: 'server-2',
      name: 'Test MCP 2',
      url: 'https://mcp2.example.com',
      transport: 'streamable-http' as const,
    };

    await expect(authenticateMcpServer(server)).rejects.toThrow();

    expect(AuthSession.makeRedirectUri).toHaveBeenCalledWith({
      scheme: 'kavi',
      path: 'mcp-auth/server-2',
    });
  });

  it('uses proxy flow when server has explicit projectNameForProxy', async () => {
    mockOpenAuth.mockResolvedValue({ type: 'cancel' });

    const server = {
      id: 'server-3',
      name: 'Test MCP 3',
      url: 'https://mcp3.example.com',
      transport: 'streamable-http' as const,
      oauth: {
        projectNameForProxy: '@myorg/myapp',
      },
    };

    await expect(authenticateMcpServer(server)).rejects.toThrow();

    const [browserUrl] = mockOpenAuth.mock.calls[0];
    // Should use the proxy start URL
    expect(browserUrl).toContain('auth.expo.io');
  });
});
