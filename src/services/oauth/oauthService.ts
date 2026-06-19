// ---------------------------------------------------------------------------
// Kavi — OAuth Service
// ---------------------------------------------------------------------------
// OAuth2 + PKCE authentication flows for provider tokens.

import type { OAuthProvider, OAuthProfile } from '../../types/oauth';
import { saveSecure, getSecure, deleteSecure } from '../storage/SecureStorage';
import { generateId } from '../../utils/id';

// ── PKCE Helpers ─────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  for (let i = 0; i < 128; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  // Use SubtleCrypto on web/native
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle.digest('SHA-256', data);
  }
  // Fallback: pure JS SHA-256 implementation
  return jsSha256(data).buffer as ArrayBuffer;
}

function jsSha256(message: Uint8Array): Uint8Array {
  const K: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  const len = message.length;
  const bitLen = len * 8;
  const padded = new Uint8Array((len + 9 + 63) & ~63);
  padded.set(message);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen, false);
  let [h0, h1, h2, h3, h4, h5, h6, h7] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Int32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  const result = new Uint8Array(32);
  const rv = new DataView(result.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => rv.setUint32(i * 4, v, false));
  return result;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await sha256(verifier);
  return base64UrlEncode(hash);
}

// ── Provider Configurations ──────────────────────────────────────────────

interface OAuthProviderConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  profileUrl?: string;
}

const PROVIDER_CONFIGS: Record<OAuthProvider, OAuthProviderConfig> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: '', // Set via settings
    scopes: ['openid', 'email', 'profile'],
    profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: '', // Set via settings
    scopes: ['read:user', 'user:email'],
    profileUrl: 'https://api.github.com/user',
  },
  openai: {
    authUrl: 'https://auth.openai.com/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: '', // Set via settings
    scopes: ['openid', 'profile'],
  },
  anthropic: {
    authUrl: 'https://console.anthropic.com/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/oauth/token',
    clientId: '', // Set via settings
    scopes: ['api'],
  },
};

// ── OAuth Flow ───────────────────────────────────────────────────────────

export interface OAuthFlowResult {
  success: boolean;
  profile?: OAuthProfile;
  error?: string;
}

/**
 * Generate authorization URL for a provider
 */
export async function getAuthorizationUrl(
  provider: OAuthProvider,
  redirectUri: string,
  clientId?: string,
): Promise<{ url: string; codeVerifier: string; state: string }> {
  const config = PROVIDER_CONFIGS[provider];
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateId();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId || config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${config.authUrl}?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId?: string,
): Promise<OAuthFlowResult> {
  const config = PROVIDER_CONFIGS[provider];

  try {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId || config.clientId,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Token exchange failed: ${res.status} ${errText}` };
    }

    const data = await res.json();
    const accessToken = data.access_token;
    if (!accessToken) {
      return { success: false, error: 'No access token in response' };
    }

    // Fetch profile if provider supports it
    let email: string | undefined;
    let name: string | undefined;
    let avatarUrl: string | undefined;

    if (config.profileUrl) {
      try {
        const profileRes = await fetch(config.profileUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          email = profile.email;
          name = profile.name || profile.login;
          avatarUrl = profile.picture || profile.avatar_url;
        }
      } catch {
        // Profile fetch is optional
      }
    }

    const oauthProfile: OAuthProfile = {
      provider,
      accessToken,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      email,
      name,
      avatarUrl,
    };

    // Persist token securely
    await saveSecure(`oauth_${provider}_token`, accessToken);
    if (data.refresh_token) {
      await saveSecure(`oauth_${provider}_refresh`, data.refresh_token);
    }

    return { success: true, profile: oauthProfile };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Token management ─────────────────────────────────────────────────────

export async function getOAuthToken(provider: OAuthProvider): Promise<string | null> {
  return getSecure(`oauth_${provider}_token`);
}

export async function clearOAuthToken(provider: OAuthProvider): Promise<void> {
  await deleteSecure(`oauth_${provider}_token`);
  await deleteSecure(`oauth_${provider}_refresh`);
}

export async function isOAuthConnected(provider: OAuthProvider): Promise<boolean> {
  const token = await getOAuthToken(provider);
  return token !== null;
}
