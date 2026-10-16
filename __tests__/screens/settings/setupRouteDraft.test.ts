import {
  expoDraftFromRoute,
  mcpDraftFromRoute,
  providerPresetFromRoute,
  setupRouteKey,
  sshDraftFromRoute,
} from '../../../src/screens/settings/setupRouteDraft';

describe('setup route drafts', () => {
  it('takes nothing from a draft that is not an object', () => {
    for (const draft of [undefined, null, 'x', 7, ['url']]) {
      expect(mcpDraftFromRoute(draft)).toEqual({});
      expect(sshDraftFromRoute(draft)).toEqual({});
      expect(expoDraftFromRoute(draft)).toEqual({});
      expect(providerPresetFromRoute(draft)).toBeUndefined();
    }
  });

  it('takes a trimmed MCP name and only an https address without spaces', () => {
    expect(mcpDraftFromRoute({ name: '  Linear ', url: 'https://mcp.linear.app/mcp' })).toEqual({
      name: 'Linear',
      url: 'https://mcp.linear.app/mcp',
    });
    expect(mcpDraftFromRoute({ url: 'https://evil.example.com/a b' })).toEqual({});
    expect(mcpDraftFromRoute({ url: 'javascript:alert(1)' })).toEqual({});
    expect(mcpDraftFromRoute({ name: 'x'.repeat(121) })).toEqual({});
    expect(mcpDraftFromRoute({ name: '   ' })).toEqual({});
  });

  it('takes an SSH port in range, a plain username and known login settings', () => {
    expect(sshDraftFromRoute({ port: '22', username: 'root' })).toEqual({
      port: 22,
      username: 'root',
    });
    for (const port of [0, -1, 65_536, 22.5, 'abc']) {
      expect(sshDraftFromRoute({ port })).toEqual({});
    }
    expect(sshDraftFromRoute({ port: 65_535 })).toEqual({ port: 65_535 });
    expect(sshDraftFromRoute({ username: 'root; rm -rf /' })).toEqual({});
    expect(sshDraftFromRoute({ username: '9lives' })).toEqual({});
    expect(sshDraftFromRoute({ authMode: 'agent', hostKeyPolicy: 'ignore' })).toEqual({});
    expect(sshDraftFromRoute({ authMode: 'password', hostKeyPolicy: 'strict' })).toEqual({
      authMode: 'password',
      hostKeyPolicy: 'strict',
    });
  });

  it('never carries a password, key or token into a form', () => {
    const draft = { password: 'p', privateKey: 'k', token: 't', apiKey: 'a', headers: { a: 'b' } };

    expect(sshDraftFromRoute(draft)).toEqual({});
    expect(mcpDraftFromRoute(draft)).toEqual({});
    expect(expoDraftFromRoute(draft)).toEqual({});
  });

  it('takes a known Expo account type only', () => {
    expect(expoDraftFromRoute({ accountType: 'personal' })).toEqual({ accountType: 'personal' });
    expect(expoDraftFromRoute({ accountType: 'admin' })).toEqual({});
  });

  it('opens the presets the AI provider guide names, Gemini on the free Gemini API', () => {
    expect(providerPresetFromRoute({ provider: 'openai' })?.name).toBe('OpenAI');
    expect(providerPresetFromRoute({ provider: 'anthropic' })?.name).toBe('Anthropic');
    expect(providerPresetFromRoute({ provider: 'openrouter' })?.name).toBe('OpenRouter');
    expect(providerPresetFromRoute({ provider: 'gemini' })).toMatchObject({
      name: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-3.8-flash',
    });
    expect(providerPresetFromRoute({ provider: 'Gemini' })).toBeUndefined();
  });

  it('remembers each request to open a form by its section and request id', () => {
    expect(setupRouteKey(undefined)).toBeNull();
    expect(setupRouteKey({ setupRequestId: 1 })).toBeNull();
    expect(setupRouteKey({ section: 'ssh-edit' })).toBe('ssh-edit:');
    expect(setupRouteKey({ section: 'ssh-edit', setupRequestId: 9 })).toBe('ssh-edit:9');
  });
});
