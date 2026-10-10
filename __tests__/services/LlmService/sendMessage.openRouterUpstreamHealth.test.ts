import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';
import {
  _resetUpstreamToolCallHealthForTests,
  noteToolCallsServedBy,
  settleToolCallOutcome,
} from '../../../src/services/llm/support/upstreamToolCallHealth';

// An upstream whose tool calls for this model keep arriving malformed is left out of the
// next tool requests — through the person's own OpenRouter key, in the request itself.

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

  it('are not changed for requests without tools', async () => {
    tripUpstream('InferenceNet');

    const body = await sentBody(openRouter(), {});

    expect(body.provider).toBeUndefined();
  });
});
