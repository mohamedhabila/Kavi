import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';
import {
  _resetUpstreamToolCallHealthForTests,
  noteToolCallsServedBy,
  noteUpstreamCacheResult,
  settleToolCallOutcome,
} from '../../../src/services/llm/support/upstreamHealth';

// An upstream whose tool calls for this model keep arriving malformed, or whose prompt cache
// never hits, is left out of the next requests — through the person's own OpenRouter key, in
// the request itself.

const MODEL = 'z-ai/glm-5.3-flash';
const TOOLS = [
  {
    name: 'update_goals',
    description: 'Update goals.',
    input_schema: {
      type: 'object',
      properties: { action: { type: 'string' }, id: { type: 'string' } },
      required: ['action', 'id'],
    },
  },
];

function tripUpstream(upstream: string): void {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  for (const id of ['fault-1', 'fault-2']) {
    noteToolCallsServedBy({ model: MODEL, upstream, toolCallIds: [id] });
    settleToolCallOutcome({ id, status: 'failed', failureKind: 'invalid_arguments' });
  }
}

function openRouter(model = MODEL) {
  return new LlmService(
    makeConfig({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-openrouter',
      model,
    }),
  );
}

async function sentBody(service: LlmService, options: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content: 'OK' } }] }),
  });
  await service.sendMessage([{ role: 'user', content: 'Plan it.' }], options as any);
  return JSON.parse(mockFetch.mock.calls.at(-1)[1].body);
}

beforeEach(() => {
  _resetUpstreamToolCallHealthForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OpenRouter tool requests after malformed tool calls', () => {
  it('leave out the upstream that produced them', async () => {
    tripUpstream('InferenceNet');

    const body = await sentBody(openRouter(), { tools: TOOLS });

    expect(body.provider).toEqual({ ignore: ['InferenceNet'] });
  });

  it('keep the other provider preferences they already carry', async () => {
    tripUpstream('InferenceNet');

    const body = await sentBody(openRouter(), { tools: TOOLS, reasoning_effort: 'low' });

    expect(body.provider).toEqual({ require_parameters: true, ignore: ['InferenceNet'] });
  });

  it('carry no exclusions for a model whose tool calls are healthy', async () => {
    tripUpstream('InferenceNet');

    const body = await sentBody(openRouter('other/model'), { tools: TOOLS });

    expect(body.provider).toBeUndefined();
  });
});

describe('OpenRouter requests after an upstream whose prompt cache never hits', () => {
  it('leave it out of every request, with or without tools', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let minute = 0; minute < 4; minute += 1) {
      noteUpstreamCacheResult({
        model: MODEL,
        upstream: 'Venice',
        prefixDigest: 'prefix|tools',
        inputTokens: 10_000,
        cacheReadTokens: 0,
        now: Date.now() - (4 - minute) * 60_000,
      });
    }

    expect((await sentBody(openRouter(), {})).provider).toEqual({ ignore: ['Venice'] });
    expect((await sentBody(openRouter(), { tools: TOOLS })).provider).toEqual({
      ignore: ['Venice'],
    });
  });
});
