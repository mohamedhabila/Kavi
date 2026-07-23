import {
  formatRedactedToolDetail,
  limitRedactedToolDetail,
  REDACTION_MARKER,
  redactSensitiveText,
} from '../../src/services/security/toolDetailRedaction';

describe('tool detail redaction', () => {
  it('redacts nested credentials while preserving useful diagnostic fields', () => {
    const detail = formatRedactedToolDetail(
      JSON.stringify({
        path: 'reports/summary.md',
        sessionId: 'agent-session-42',
        sessionToken: 'session-value-that-must-not-render',
        maxTokens: 4096,
        apiKey: 'sk-or-v1-1234567890abcdefghijklmnop',
        nested: {
          access_token: 'access-value-that-must-not-render',
          headers: {
            Authorization: 'Bearer bearer-value-that-must-not-render',
            Accept: 'application/json',
          },
        },
        items: [{ clientSecret: 'client-value-that-must-not-render', count: 2 }],
      }),
    );

    expect(detail?.text).toContain('reports/summary.md');
    expect(detail?.text).toContain('agent-session-42');
    expect(detail?.text).toContain('4096');
    expect(detail?.text).toContain('application/json');
    expect(detail?.text).toContain(REDACTION_MARKER);
    expect(detail?.text).not.toContain('1234567890abcdefghijklmnop');
    expect(detail?.text).not.toContain('access-value-that-must-not-render');
    expect(detail?.text).not.toContain('bearer-value-that-must-not-render');
    expect(detail?.text).not.toContain('client-value-that-must-not-render');
    expect(detail?.text).not.toContain('session-value-that-must-not-render');
  });

  it('redacts credentials in malformed text, headers, URLs, and known token formats', () => {
    const githubToken = ['github', 'pat', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('_');
    const raw = [
      'Authorization: Bearer header-secret-value',
      'OPENROUTER_API_KEY=sk-or-v1-abcdefghijklmnopqrstuvwxyz123456',
      'SESSION_TOKEN=session-token-value-that-must-not-render',
      'cookie: session=private-cookie-value; theme=dark',
      'fetch https://example.com/run?token=query-secret-value&mode=safe',
      githubToken,
      'eyJabcdefghijk.eyJabcdefghijkl.mnopqrstuvwxyz',
    ].join('\n');

    const redacted = redactSensitiveText(raw);

    expect(redacted).toContain(REDACTION_MARKER);
    expect(redacted).toContain('mode=safe');
    expect(redacted).not.toContain('header-secret-value');
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(redacted).not.toContain('private-cookie-value');
    expect(redacted).not.toContain('session-token-value-that-must-not-render');
    expect(redacted).not.toContain('query-secret-value');
    expect(redacted).not.toContain('eyJabcdefghijk');
    expect(redacted).not.toContain(githubToken);
  });

  it('redacts incomplete private keys and URL passwords', () => {
    const redacted = redactSensitiveText(
      [
        'ssh://operator:remote-password@example.com/project',
        '-----BEGIN PRIVATE KEY-----',
        'private-key-material',
      ].join('\n'),
    );

    expect(redacted).toContain(`operator:${REDACTION_MARKER}@example.com`);
    expect(redacted).not.toContain('remote-password');
    expect(redacted).not.toContain('private-key-material');
  });

  it('limits output only after sensitive values have been removed', () => {
    const secret = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz123456';
    const detail = formatRedactedToolDetail(
      JSON.stringify({ apiKey: secret, output: 'a'.repeat(200) }),
      60,
    );

    expect(detail).toEqual(expect.objectContaining({ truncated: true }));
    expect(detail?.text).toContain(REDACTION_MARKER);
    expect(detail?.text).not.toContain(secret);
    expect(detail?.text.endsWith('\n…')).toBe(true);

    const shorterPreview = limitRedactedToolDetail(detail, 30);
    expect(shorterPreview).toEqual(expect.objectContaining({ truncated: true }));
    expect(shorterPreview?.text).not.toContain(secret);
  });

  it('returns null for empty payloads', () => {
    expect(formatRedactedToolDetail(undefined)).toBeNull();
    expect(formatRedactedToolDetail('   ')).toBeNull();
  });
});
