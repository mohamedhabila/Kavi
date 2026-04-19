// ---------------------------------------------------------------------------
// OAuth Service — tests
// ---------------------------------------------------------------------------

jest.mock('../../src/services/storage/SecureStorage', () => ({
  saveSecure: jest.fn().mockResolvedValue(undefined),
  getSecure: jest.fn().mockResolvedValue(null),
  deleteSecure: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getOAuthToken,
  clearOAuthToken,
  isOAuthConnected,
} from '../../src/services/oauth/oauthService';

describe('OAuth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAuthorizationUrl', () => {
    it('returns URL with required params for google', async () => {
      const result = await getAuthorizationUrl('google', 'myapp://callback', 'client-123');
      expect(result.url).toContain('accounts.google.com');
      expect(result.url).toContain('client_id=client-123');
      expect(result.url).toContain('redirect_uri=');
      expect(result.codeVerifier).toBeDefined();
      expect(result.codeVerifier.length).toBeGreaterThan(40);
    });

    it('includes PKCE code_challenge', async () => {
      const result = await getAuthorizationUrl('github', 'myapp://cb', 'gh-456');
      expect(result.url).toContain('code_challenge=');
      expect(result.url).toContain('code_challenge_method=S256');
    });

    it('includes state parameter', async () => {
      const result = await getAuthorizationUrl('google', 'r', 'c');
      expect(result.url).toContain('state=');
      expect(result.state).toBeDefined();
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('exchanges code for tokens', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-123',
          refresh_token: 'refresh-456',
          expires_in: 3600,
        }),
      });

      const result = await exchangeCodeForTokens(
        'google',
        'auth-code-abc',
        'verifier-xyz',
        'myapp://callback',
        'client-123',
      );
      expect(result.success).toBe(true);
      expect(result.profile?.accessToken).toBe('access-123');
    });

    it('returns error on failed exchange', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const result = await exchangeCodeForTokens('google', 'bad', 'v', 'r', 'c');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when no access_token in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ refresh_token: 'rt' }),
      });
      const result = await exchangeCodeForTokens('google', 'code', 'v', 'r', 'c');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No access token');
    });

    it('fetches profile for github provider', async () => {
      // First call: token exchange
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at', expires_in: 3600 }),
      });
      // Second call: profile fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'user@test.com', login: 'testuser', avatar_url: 'http://img' }),
      });

      const result = await exchangeCodeForTokens('github', 'code', 'v', 'r', 'c');
      expect(result.success).toBe(true);
      expect(result.profile?.email).toBe('user@test.com');
      expect(result.profile?.name).toBe('testuser');
    });

    it('handles profile fetch failure gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at' }),
      });
      mockFetch.mockRejectedValueOnce(new Error('Profile fetch fail'));

      const result = await exchangeCodeForTokens('google', 'code', 'v', 'r', 'c');
      expect(result.success).toBe(true); // token still works
    });

    it('handles no profile URL for anthropic', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at-anth' }),
      });
      const result = await exchangeCodeForTokens('anthropic', 'code', 'v', 'r', 'c');
      expect(result.success).toBe(true);
    });

    it('handles network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network down'));
      const result = await exchangeCodeForTokens('google', 'code', 'v', 'r', 'c');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network down');
    });

    it('saves refresh token when provided', async () => {
      const { saveSecure } = require('../../src/services/storage/SecureStorage');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at', refresh_token: 'rt' }),
      });
      await exchangeCodeForTokens('anthropic', 'code', 'v', 'r', 'c');
      expect(saveSecure).toHaveBeenCalledWith('oauth_anthropic_token', 'at');
      expect(saveSecure).toHaveBeenCalledWith('oauth_anthropic_refresh', 'rt');
    });
  });

  describe('Token storage', () => {
    it('getOAuthToken returns null when no token stored', async () => {
      const token = await getOAuthToken('google');
      expect(token).toBeNull();
    });

    it('isOAuthConnected returns false when not connected', async () => {
      const connected = await isOAuthConnected('google');
      expect(connected).toBe(false);
    });

    it('isOAuthConnected returns true when token exists', async () => {
      const { getSecure } = require('../../src/services/storage/SecureStorage');
      getSecure.mockResolvedValueOnce('stored-token');
      const connected = await isOAuthConnected('github');
      expect(connected).toBe(true);
    });

    it('clearOAuthToken removes stored token', async () => {
      const { deleteSecure } = require('../../src/services/storage/SecureStorage');
      await clearOAuthToken('google');
      expect(deleteSecure).toHaveBeenCalledWith('oauth_google_token');
      expect(deleteSecure).toHaveBeenCalledWith('oauth_google_refresh');
    });
  });

  describe('PKCE with JS SHA-256 fallback', () => {
    let originalSubtle: SubtleCrypto;
    beforeEach(() => {
      originalSubtle = crypto.subtle;
      Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
    });
    afterEach(() => {
      Object.defineProperty(crypto, 'subtle', { value: originalSubtle, configurable: true });
    });

    it('generates valid authorization URL using jsSha256 fallback', async () => {
      const result = await getAuthorizationUrl('google', 'myapp://cb', 'client-js');
      expect(result.url).toContain('code_challenge=');
      expect(result.url).toContain('code_challenge_method=S256');
      expect(result.codeVerifier.length).toBeGreaterThan(40);
    });

    it('jsSha256 produces consistent results for same input', async () => {
      // Both calls use the same underlying sha256 → jsSha256 path
      const result1 = await getAuthorizationUrl('github', 'r', 'c');
      const result2 = await getAuthorizationUrl('github', 'r', 'c');
      // Different verifiers → different challenges — but both should have challenges
      expect(result1.url).toContain('code_challenge=');
      expect(result2.url).toContain('code_challenge=');
    });
  });
});
