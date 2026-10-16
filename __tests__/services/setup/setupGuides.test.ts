const mockGetSecure = jest.fn();
const mockAvailability = { hasExpoAccounts: false, hasSshTargets: false };
const mockStatuses: Array<{ id: string; state: string }> = [];

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

import { executeSetupGuide } from '../../../src/engine/tools/toolSetupGuideExecution';
import { SETUP_TOPICS } from '../../../src/services/setup/setupGuideTypes';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

async function guide(args: Record<string, unknown>) {
  const outcome = await executeSetupGuide(args);
  return {
    outcome,
    body: outcome.status === 'completed' ? JSON.parse(outcome.content) : undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSecure.mockResolvedValue(null);
  mockAvailability.hasExpoAccounts = false;
  mockAvailability.hasSshTargets = false;
  mockStatuses.length = 0;
  useSettingsStore.setState({ mcpServers: [] });
});

describe('setup guides', () => {
  it.each(SETUP_TOPICS)(
    'has a sourced, dated guide that ends at a Kavi form for %s',
    async (topic) => {
      const { body } = await guide({ topic });

      expect(body.topic).toBe(topic);
      expect(body.guide.steps.length).toBeGreaterThan(0);
      expect(body.guide.sources.length).toBeGreaterThan(0);
      expect(body.guide.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.guide.unlocks).toBeTruthy();
    },
  );

  it('never asks for a secret in the chat, in any step', async () => {
    for (const topic of SETUP_TOPICS) {
      const { body } = await guide({ topic });
      const said = JSON.stringify(body.guide.steps);
      expect(said).not.toMatch(/paste (it|the \w+) (here|in the chat)/i);
    }
  });

  it('opens the SSH form with the port, username and login type the server guide uses', async () => {
    const { body } = await guide({ topic: 'server' });

    expect(body).toMatchObject({ status: 'setup_needed', state: { configured: false } });
    expect(body.guide.form).toEqual({
      kind: 'settings',
      section: 'ssh-edit',
      draft: {
        port: 22,
        username: 'root',
        authMode: 'password',
        hostKeyPolicy: 'trust-on-first-use',
      },
    });
    expect(body.guide.options.map((option: { id: string }) => option.id)).toEqual([
      'oracle_free',
      'digitalocean',
      'ovh',
    ]);
  });

  it('says a topic is already set up when it is', async () => {
    mockAvailability.hasExpoAccounts = true;

    await expect(guide({ topic: 'app_building' })).resolves.toMatchObject({
      body: { status: 'already_set_up', state: { configured: true } },
    });
  });

  it("opens the MCP form with a directory service's own address, by name in any case", async () => {
    const { body } = await guide({ topic: 'connect_app', option: 'Notion' });

    expect(body.guide.form).toEqual({
      kind: 'settings',
      section: 'mcp-edit',
      draft: { name: 'Notion', url: 'https://mcp.notion.com/mcp' },
    });
    expect(body.state).toEqual({ configured: false, detail: 'Notion is not connected yet.' });
    expect(body.registry).toBeUndefined();
  });

  it('knows a directory service is connected', async () => {
    useSettingsStore.setState({
      mcpServers: [{ id: 'notion-1', url: 'https://mcp.notion.com/mcp' } as never],
    });
    mockStatuses.push({ id: 'notion-1', state: 'connected' });

    await expect(guide({ topic: 'connect_app', option: 'notion' })).resolves.toMatchObject({
      body: { status: 'already_set_up' },
    });
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
    expect(body.guide.steps.length).toBeGreaterThan(0);
  });

  it('refuses a topic it has no guide for', async () => {
    const { outcome } = await guide({ topic: 'quantum' });

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'invalid_arguments' });
  });
});
