import { fetchProviderModels } from '../../../../src/services/llm/catalog/modelDiscovery';
import { mergeDiscoveredModelCatalog } from '../../../../src/services/llm/catalog/providerCatalogSync';
import { buildProviderHeaders } from '../../../../src/services/llm/core/providerRequest';
import { clearProviderContextWindowsForTests } from '../../../../src/services/context/providerContextWindows';
import type { LlmProviderConfig } from '../../../../src/types/provider';

// A personal key that may act in several workspaces must name one on every request
// (anthropic-workspace-id), or the API answers 400 "This API key is not scoped to a
// workspace". Kavi sent no workspace, and discovery hid it: the models request failed the
// same way and the static catalog stood in, so every chat request then failed.

const DEFAULT_WORKSPACE = 'wrkspc_default';
const TEAM_WORKSPACE = 'wrkspc_team';

const createTimeoutSignal = () => new AbortController().signal;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const MODELS = {
  data: [{ id: 'claude-sonnet-5-5', max_input_tokens: 1_000_000 }],
  has_more: false,
};

/** The API as a key that may act in DEFAULT_WORKSPACE and TEAM_WORKSPACE sees it. */
function multiWorkspaceApi() {
  return jest.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    if (url.includes('/organizations/workspaces')) {
      return jsonResponse({
        data: url.includes('include_default=true')
          ? [{ id: DEFAULT_WORKSPACE }, { id: TEAM_WORKSPACE }]
          : [{ id: TEAM_WORKSPACE }],
      });
    }
    return headers['anthropic-workspace-id']
      ? jsonResponse(MODELS)
      : jsonResponse({ error: { type: 'invalid_request_error' } }, false, 400);
  });
}

function discover(performFetch: jest.Mock, provider: Partial<LlmProviderConfig> = {}) {
  const config = {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'test-key',
    model: 'claude-sonnet-5-5',
    enabled: true,
    providerFamily: 'anthropic' as const,
    ...provider,
  };
  return fetchProviderModels({
    provider: config,
    baseUrl: config.baseUrl,
    headers: buildProviderHeaders(config),
    transport: 'anthropic',
    createTimeoutSignal,
    performFetch,
  });
}

beforeEach(() => {
  clearProviderContextWindowsForTests();
});

describe('Anthropic workspace discovery', () => {
  it('names the Default workspace for a key that may act in several', async () => {
    const api = multiWorkspaceApi();

    const result = await discover(api);

    expect(result.anthropicWorkspaceId).toBe(DEFAULT_WORKSPACE);
    expect(result.models).toEqual(['claude-sonnet-5-5']);
    const modelsCall = api.mock.calls.find(([url]) => url.includes('/models'))!;
    expect((modelsCall[1].headers as Record<string, string>)['anthropic-workspace-id']).toBe(
      DEFAULT_WORKSPACE,
    );
  });

  it('keeps the workspace the provider already runs in while it exists', async () => {
    const result = await discover(multiWorkspaceApi(), { anthropicWorkspaceId: TEAM_WORKSPACE });

    expect(result.anthropicWorkspaceId).toBe(TEAM_WORKSPACE);
  });

  it('names none for a key bound to one workspace', async () => {
    const api = jest.fn(async (url: string, init: RequestInit) =>
      url.includes('/organizations/workspaces')
        ? jsonResponse({ error: { type: 'permission_error' } }, false, 403)
        : (init.headers as Record<string, string>)['anthropic-workspace-id']
          ? jsonResponse({}, false, 400)
          : jsonResponse(MODELS),
    );

    const result = await discover(api, { anthropicWorkspaceId: 'wrkspc_stale' });

    expect(result.anthropicWorkspaceId).toBeNull();
    expect(result.models).toEqual(['claude-sonnet-5-5']);
  });

  it('leaves the workspace undecided when the listing cannot be reached', async () => {
    const api = jest.fn(async (url: string) => {
      if (url.includes('/organizations/workspaces')) throw new Error('network down');
      return jsonResponse(MODELS);
    });

    const result = await discover(api, { anthropicWorkspaceId: TEAM_WORKSPACE });

    expect(result).not.toHaveProperty('anthropicWorkspaceId');
    const modelsCall = api.mock.calls.find(([url]) => url.includes('/models'))!;
    expect((modelsCall[1].headers as Record<string, string>)['anthropic-workspace-id']).toBe(
      TEAM_WORKSPACE,
    );
  });
});

describe('Anthropic workspace on requests', () => {
  const anthropic = {
    kind: 'cloud' as const,
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    providerFamily: 'anthropic' as const,
    apiKey: 'test-key',
  };

  it('is sent on every request once the provider has one', () => {
    expect(buildProviderHeaders(anthropic)).not.toHaveProperty('anthropic-workspace-id');
    expect(
      buildProviderHeaders({ ...anthropic, anthropicWorkspaceId: DEFAULT_WORKSPACE }),
    ).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-workspace-id': DEFAULT_WORKSPACE });
  });

  it('is saved, cleared or kept as discovery found it', () => {
    const provider = {
      id: 'anthropic',
      name: 'Anthropic',
      baseUrl: anthropic.baseUrl,
      apiKey: '',
      model: 'claude-sonnet-5-5',
      enabled: true,
      anthropicWorkspaceId: TEAM_WORKSPACE,
    } satisfies LlmProviderConfig;
    const discovered = { models: ['claude-sonnet-5-5'], capabilities: {}, contextWindows: {} };

    expect(
      mergeDiscoveredModelCatalog(provider, {
        ...discovered,
        anthropicWorkspaceId: DEFAULT_WORKSPACE,
      }).anthropicWorkspaceId,
    ).toBe(DEFAULT_WORKSPACE);
    expect(
      mergeDiscoveredModelCatalog(provider, { ...discovered, anthropicWorkspaceId: null }),
    ).not.toHaveProperty('anthropicWorkspaceId');
    expect(mergeDiscoveredModelCatalog(provider, discovered).anthropicWorkspaceId).toBe(
      TEAM_WORKSPACE,
    );
  });
});
