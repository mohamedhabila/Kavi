import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpOAuthError } from './oauthErrors';

export function randomBase64Url(bytesLength = 32): string {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);

  let raw = '';
  for (const byte of bytes) {
    raw += String.fromCharCode(byte);
  }

  const base64 = btoa(raw);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsSha256(message: Uint8Array): Uint8Array {
  const K: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  const length = message.length;
  const bitLength = length * 8;
  const padded = new Uint8Array((length + 9 + 63) & ~63);
  padded.set(message);
  padded[length] = 0x80;

  const dataView = new DataView(padded.buffer);
  dataView.setUint32(padded.length - 4, bitLength, false);

  let [h0, h1, h2, h3, h4, h5, h6, h7] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Int32Array(64);
    for (let index = 0; index < 16; index += 1) {
      words[index] = dataView.getInt32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotr(7, words[index - 15]) ^
        rotr(18, words[index - 15]) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotr(17, words[index - 2]) ^
        rotr(19, words[index - 2]) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + K[index] + words[index]) | 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) | 0;

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
  const resultView = new DataView(result.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => {
    resultView.setUint32(index * 4, value, false);
  });
  return result;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) {
    raw += String.fromCharCode(byte);
  }

  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function buildAuthorizationRequest(params: {
  metadata: AuthorizationServerMetadata;
  clientInformation: OAuthClientInformationFull;
  redirectUrl: string;
  scope?: string;
  state: string;
  resource?: URL;
}): { authorizationUrl: URL; codeVerifier: string } {
  const authorizationEndpoint = params.metadata.authorization_endpoint;
  if (!authorizationEndpoint) {
    throw new McpOAuthError(
      'This server did not provide an OAuth authorization endpoint.',
      'configuration_required',
    );
  }

  const clientId = params.clientInformation.client_id?.trim();
  if (!clientId) {
    throw new McpOAuthError(
      'This server requires an OAuth client registration. Edit this server to add a client ID and optional client secret.',
      'configuration_required',
    );
  }

  const codeVerifier = randomBase64Url(64);
  const codeChallenge = base64UrlEncode(jsSha256(new TextEncoder().encode(codeVerifier)));
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: params.redirectUrl,
    state: params.state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  if (params.scope) {
    query.set('scope', params.scope);
  }
  if (params.resource) {
    query.append('resource', params.resource.toString());
  }

  return {
    authorizationUrl: new URL(`${authorizationEndpoint}?${query.toString()}`),
    codeVerifier,
  };
}
