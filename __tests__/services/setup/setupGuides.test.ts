const mockGetSecure = jest.fn();
const mockAvailability = { hasExpoAccounts: false, hasSshTargets: false };
const mockStatuses: Array<{ id: string; state: string }> = [];
const mockWebFetch = jest.fn();

jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: unknown[]) => mockGetSecure(...args),
}));
jest.mock('../../../src/engine/tools/runtimeAvailability', () => ({
  getRuntimeToolAvailabilityContext: () => mockAvailability,
}));
jest.mock('../../../src/services/mcp/manager', () => ({
  mcpManager: { getAllStatuses: () => mockStatuses },
}));
jest.mock('../../../src/services/assistant/assistantRole', () => ({
  getAssistantRoleState: jest.fn(async () => 'not_held'),
}));
jest.mock('../../../src/services/notifications/notificationReader', () => ({
  getNotificationAccessState: jest.fn(async () => 'granted'),
}));
jest.mock('../../../src/engine/tools/web-fetch', () => ({
  executeWebFetch: (...args: unknown[]) => mockWebFetch(...args),
}));

import { executeSetupGuide } from '../../../src/engine/tools/toolSetupGuideExecution';
import { SETUP_TOPICS } from '../../../src/services/setup/setupGuideTypes';
import { setupGuideFor } from '../../../src/services/setup/setupGuides';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

async function guide(args: Record<string, unknown>) {
  const outcome = await executeSetupGuide(args);
  return {
    outcome,
    body: outcome.status === 'completed' ? JSON.parse(outcome.content) : undefined,
  };
}

/** web_fetch as it answers: one entry per URL, failed outcome when the entry has an error. */
function pageFetched(url: string, content = `Current terms on ${url}`) {
  return {
    status: 'completed',
    content: JSON.stringify({
      fetches: [
        {
          url,
          title: 'Vendor page',
          content,
          truncated: true,
          charCount: 20_000,
          nextOffset: 5_000,
        },
      ],
    }),
  };
}

function registryAnswer(servers: unknown[]) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ servers }),
  })) as unknown as typeof fetch;
}

const realFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  mockGetSecure.mockResolvedValue(null);
  mockAvailability.hasExpoAccounts = false;
  mockAvailability.hasSshTargets = false;
  mockStatuses.length = 0;
  useSettingsStore.setState({ mcpServers: [] });
  mockWebFetch.mockImplementation(async ({ urls }: { urls: string[] }) => pageFetched(urls[0]!));
  registryAnswer([]);
});
afterAll(() => {
  global.fetch = realFetch;
});

describe('setup guides', () => {
  it.each(SETUP_TOPICS)('ends at a Kavi form or setting, with Kavi-side steps, for %s', (topic) => {
    const resolved = setupGuideFor(topic, undefined);

    expect(resolved.topic).toBe(topic);
    expect(resolved.unlocks).toBeTruthy();
    expect(resolved.kaviSteps.length).toBeGreaterThan(0);
    expect(resolved.afterSetup).toBeTruthy();
  });

  it('holds no prices: what a vendor charges comes from its pages', () => {
    for (const topic of SETUP_TOPICS) {
      const options = [
        undefined,
        ...(setupGuideFor(topic, undefined).options ?? []).map((o) => o.id),
      ];
      for (const option of options) {
        const resolved = setupGuideFor(topic, option);
        const { pages: _pages, options: _options, ...said } = resolved;
        expect(JSON.stringify(said)).not.toMatch(/[$€£]\s?\d/u);
      }
    }
  });

  it('never asks for a secret in the chat, in any step', () => {
    for (const topic of SETUP_TOPICS) {
      const said = JSON.stringify(setupGuideFor(topic, undefined).kaviSteps);
      expect(said).not.toMatch(/paste (it|the \w+) (here|in the chat)/i);
    }
  });

  it('reads at most four https pages per guide, each bounded', () => {
    for (const topic of SETUP_TOPICS) {
      const base = setupGuideFor(topic, undefined);
      for (const option of [undefined, ...(base.options ?? []).map((o) => o.id)]) {
        const { pages } = setupGuideFor(topic, option);
        expect(pages.length).toBeLessThanOrEqual(4);
        for (const page of pages) {
          expect(page.url).toMatch(/^https:\/\//u);
          expect(page.about).toBeTruthy();
          expect(page.maxChars ?? 5_000).toBeLessThanOrEqual(10_000);
        }
      }
    }
  });

  it('compares the options from their pages, then reads the chosen one’s steps', async () => {
    const overview = (await guide({ topic: 'server' })).body;

    expect(overview.research.pages.map((page: { about: string }) => page.about)).toEqual([
      "Oracle's Always Free resources",
      'DigitalOcean Droplet prices',
      'OVHcloud VPS plans and prices',
      'what a domain name costs a year (.com and other endings), for a website on the server',
    ]);
    expect(overview.research).toMatchObject({ fetchedAt: expect.any(String), failed: [] });
    expect(overview.research.pages[0]).toMatchObject({
      excerpt: expect.stringContaining('Current terms on https://docs.oracle.com'),
      truncated: true,
      nextOffset: 5_000,
    });

    const chosen = (await guide({ topic: 'server', option: 'digitalocean' })).body;

    expect(chosen.research.pages.map((page: { url: string }) => page.url)).toEqual([
      'https://docs.digitalocean.com/products/droplets/getting-started/quickstart/',
      'https://docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/',
    ]);
    expect(chosen.guide.form).toEqual({
      kind: 'settings',
      section: 'ssh-edit',
      draft: {
        port: 22,
        hostKeyPolicy: 'trust-on-first-use',
        username: 'root',
        authMode: 'password',
      },
    });
    expect(mockWebFetch).toHaveBeenCalledWith(
      {
        urls: ['https://docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/'],
        maxChars: 5_000,
      },
      expect.any(Object),
    );
  });

  it('reads more of a page whose facts sit further down', async () => {
    await guide({ topic: 'ai_provider', option: 'gemini' });

    expect(mockWebFetch).toHaveBeenCalledWith(
      { urls: ['https://ai.google.dev/gemini-api/docs/rate-limits'], maxChars: 10_000 },
      expect.any(Object),
    );
  });

  it('still answers when a page fails, naming it so Kavi can fetch or search', async () => {
    mockWebFetch.mockImplementation(async ({ urls }: { urls: string[] }) =>
      urls[0]!.includes('ovhcloud')
        ? {
            status: 'failed',
            content: JSON.stringify({
              fetches: [{ requestedUrl: urls[0], error: 'Fetch failed: HTTP 503' }],
            }),
          }
        : pageFetched(urls[0]!),
    );

    const { body } = await guide({ topic: 'server' });

    expect(body.status).toBe('setup_needed');
    expect(body.research.pages).toHaveLength(3);
    expect(body.research.failed).toEqual([
      {
        url: 'https://us.ovhcloud.com/vps/',
        about: 'OVHcloud VPS plans and prices',
        error: 'Fetch failed: HTTP 503',
      },
    ]);
  });

  it('gives up on slow pages after twelve seconds and answers with what it has', async () => {
    jest.useFakeTimers();
    try {
      mockWebFetch.mockImplementation(({ urls }: { urls: string[] }) =>
        urls[0]!.includes('digitalocean')
          ? new Promise(() => undefined)
          : Promise.resolve(pageFetched(urls[0]!)),
      );

      const pending = guide({ topic: 'server' });
      await jest.advanceTimersByTimeAsync(12_000);
      const { body } = await pending;

      expect(body.research.pages).toHaveLength(3);
      expect(body.research.failed).toEqual([
        expect.objectContaining({
          url: 'https://www.digitalocean.com/products/droplets',
          error: 'The page did not load in time.',
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads nothing for a guide about the phone’s own settings', async () => {
    const { body } = await guide({ topic: 'phone_access' });

    expect(body).not.toHaveProperty('research');
    expect(mockWebFetch).not.toHaveBeenCalled();
  });

  it('says a topic is already set up when it is', async () => {
    mockAvailability.hasExpoAccounts = true;

    await expect(guide({ topic: 'app_building' })).resolves.toMatchObject({
      body: { status: 'already_set_up', state: { configured: true } },
    });
  });

  it("opens the MCP form with the address the vendor's registry entry lists now", async () => {
    registryAnswer([
      {
        server: {
          name: 'com.notion/mcp',
          remotes: [
            { type: 'sse', url: 'https://mcp.notion.com/sse' },
            { type: 'streamable-http', url: 'https://mcp.notion.com/v2/mcp' },
          ],
        },
      },
    ]);

    const { body } = await guide({ topic: 'connect_app', option: 'Notion' });

    expect(jest.mocked(global.fetch).mock.calls[0]![0]).toContain('search=com.notion%2Fmcp');
    expect(body.address).toEqual({ url: 'https://mcp.notion.com/v2/mcp', checked: 'registry' });
    expect(body.guide.form).toEqual({
      kind: 'settings',
      section: 'mcp-edit',
      draft: { name: 'Notion', url: 'https://mcp.notion.com/v2/mcp' },
    });
    expect(body.state).toEqual({ configured: false, detail: 'Notion is not connected yet.' });
    expect(body.registry).toBeUndefined();
  });

  it('keeps the directory address while the registry still lists it, or cannot be reached', async () => {
    registryAnswer([
      {
        server: {
          name: 'com.notion/mcp',
          remotes: [{ type: 'streamable-http', url: 'https://mcp.notion.com/mcp' }],
        },
      },
      {
        server: {
          name: 'ai.smithery/notion',
          remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp' }],
        },
      },
    ]);
    await expect(guide({ topic: 'connect_app', option: 'notion' })).resolves.toMatchObject({
      body: { address: { url: 'https://mcp.notion.com/mcp', checked: 'registry' } },
    });

    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const { body } = await guide({ topic: 'connect_app', option: 'notion' });

    expect(body.address).toMatchObject({
      url: 'https://mcp.notion.com/mcp',
      checked: 'directory',
      note: expect.stringContaining('could not be reached'),
    });
    expect(body.guide.form.draft.url).toBe('https://mcp.notion.com/mcp');
  });

  it('knows a directory service is connected at either address', async () => {
    useSettingsStore.setState({
      mcpServers: [{ id: 'notion-1', url: 'https://mcp.notion.com/mcp' } as never],
    });
    mockStatuses.push({ id: 'notion-1', state: 'connected' });

    await expect(guide({ topic: 'connect_app', option: 'notion' })).resolves.toMatchObject({
      body: { status: 'already_set_up' },
    });
  });

  it('reads GitHub’s token page, since its server takes a token', async () => {
    const { body } = await guide({ topic: 'connect_app', option: 'github' });

    expect(body.research.pages[0].url).toContain('docs.github.com');
    expect(body.guide.options[0].note).toContain('personal access token');
  });

  it('reads a service key and the phone settings from the phone itself', async () => {
    mockGetSecure.mockImplementation(async (key: string) =>
      key === 'BRAVE_API_KEY' ? 'key' : null,
    );

    await expect(guide({ topic: 'service_key', option: 'BRAVE_API_KEY' })).resolves.toMatchObject({
      body: { status: 'already_set_up', guide: { optionId: 'BRAVE_API_KEY' } },
    });
    await expect(
      guide({ topic: 'service_key', option: 'PERPLEXITY_API_KEY' }),
    ).resolves.toMatchObject({
      body: { status: 'setup_needed' },
    });
    await expect(
      guide({ topic: 'phone_access', option: 'notification_access' }),
    ).resolves.toMatchObject({
      body: {
        status: 'already_set_up',
        guide: { form: { kind: 'system', access: 'notification_access' } },
      },
    });
    await expect(guide({ topic: 'phone_access' })).resolves.toMatchObject({
      body: {
        status: 'setup_needed',
        guide: { form: { kind: 'system', access: 'assistant_role' } },
      },
    });
  });

  it('knows when Kavi can make calls for the person', async () => {
    await expect(guide({ topic: 'phone_calls' })).resolves.toMatchObject({
      body: { status: 'setup_needed', guide: { form: { section: 'service-keys' } } },
    });

    mockGetSecure.mockImplementation(async (key: string) =>
      key === 'BLAND_API_KEY' ? 'key' : null,
    );

    await expect(guide({ topic: 'phone_calls' })).resolves.toMatchObject({
      body: { status: 'already_set_up' },
    });
  });

  it('opens no phone setting a phone cannot change', async () => {
    const { getAssistantRoleState } = jest.requireMock(
      '../../../src/services/assistant/assistantRole',
    );
    getAssistantRoleState.mockResolvedValueOnce('unavailable');

    const { body } = await guide({ topic: 'phone_access' });

    expect(body).toMatchObject({
      status: 'not_possible_on_this_phone',
      state: { configured: null, unavailable: true },
    });
    expect(body.guide).not.toHaveProperty('form');
    expect(body.guide.kaviSteps.length).toBeGreaterThan(0);
  });

  it('refuses a topic it has no guide for', async () => {
    const { outcome } = await guide({ topic: 'quantum' });

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'invalid_arguments' });
  });
});
