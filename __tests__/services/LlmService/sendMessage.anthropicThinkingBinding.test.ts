import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';
import { noteAnthropicInputTransformations } from '../../../src/services/llm/providers/anthropic/inputTransformations';

// Claude Sonnet 5.5 (and Opus 5.5, Haiku 5.5, Fable 5.1) accepts a replayed thinking block
// only while everything before it is unchanged. Kavi put each request's dynamic context on
// the newest user message, and in Anthropic's format tool results are user messages: the
// context moved one step every tool call, the history before Claude's latest thinking
// changed, and the next request failed with 400 "The block is bound to a different
// conversation", ending the run (live: organic-mobile-assistant-continuity, turn 8).

const READ_FILE = {
  name: 'read_file',
  description: 'Read a file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

function toolStep(id: string, signature: string, result: string): any[] {
  const call = { id, type: 'function', function: { name: 'read_file', arguments: '{}' } };
  return [
    {
      role: 'assistant',
      content: '',
      providerReplay: {
        anthropicBlocks: [
          { type: 'thinking', thinking: `Read ${id}.`, signature },
          { type: 'tool_use', id, name: 'read_file', input: {} },
        ],
      },
      tool_calls: [{ ...call, raw: call }],
    },
    { role: 'tool', tool_call_id: id, content: result },
  ];
}

const OPTIONS = {
  enablePromptCaching: true,
  thinking: { type: 'adaptive' },
  tools: [READ_FILE],
  systemPromptSections: [
    { text: 'You are Kavi.', cacheable: true },
    { text: 'Runtime context: 2026-10-15 10:00', cacheable: false },
  ],
};

function service(): LlmService {
  return new LlmService(
    makeConfig({
      id: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-5-5',
    }),
  );
}

/** The system message the request carries, as the sections in OPTIONS joined. */
const SYSTEM = {
  role: 'system',
  content: OPTIONS.systemPromptSections.map((section) => section.text).join('\n\n'),
};

async function send(messages: any[]): Promise<{ body: any; headers: Record<string, string> }> {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
  });
  await service().sendMessage([SYSTEM, ...messages], OPTIONS as never);
  const [, init] = mockFetch.mock.calls.at(-1);
  return { body: JSON.parse(init.body), headers: init.headers };
}

describe('Anthropic thinking across a tool loop', () => {
  it('keeps the history before each thinking block unchanged from one step to the next', async () => {
    const person = { role: 'user', content: 'Plan my week from the notes.' };
    const first = await send([person, ...toolStep('toolu_1', 'sig-1', 'notes A')]);
    const second = await send([
      person,
      ...toolStep('toolu_1', 'sig-1', 'notes A'),
      ...toolStep('toolu_2', 'sig-2', 'notes B'),
    ]);

    // The dynamic context sits on the person's message, never on a tool result.
    expect(JSON.stringify(first.body.messages[0])).toContain('Runtime context');
    for (const message of second.body.messages.slice(1)) {
      expect(JSON.stringify(message)).not.toContain('Runtime context');
    }
    // Everything up to the second step's thinking is exactly what the first step sent.
    expect(second.body.messages.slice(0, first.body.messages.length)).toEqual(first.body.messages);
    expect(second.body.system).toEqual(first.body.system);
    expect(second.body.tools).toEqual(first.body.tools);
  });

  it('asks the API to drop, not refuse, a thinking block whose history Kavi changed', async () => {
    const { body, headers } = await send([{ role: 'user', content: 'Hello' }]);

    expect(body.thinking).toMatchObject({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    });
    expect(headers['anthropic-beta']).toContain('thinking-binding-controls-2026-08-01');
  });
});

describe('noteAnthropicInputTransformations', () => {
  it('counts the thinking blocks the API dropped', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      noteAnthropicInputTransformations(
        [
          {
            type: 'thinking_dropped',
            path: 'messages.3.content.0',
            reason: 'prefix_binding_mismatch',
          },
          {
            type: 'thinking_dropped',
            path: 'messages.5.content.0',
            reason: 'model_binding_mismatch',
          },
          { type: 'something_new', path: 'messages.1', reason: 'x' },
        ],
        'claude-sonnet-5-5',
      ),
    ).toBe(2);
    expect(noteAnthropicInputTransformations([], 'claude-sonnet-5-5')).toBe(0);
    expect(noteAnthropicInputTransformations(undefined, 'claude-sonnet-5-5')).toBe(0);
    warn.mockRestore();
  });
});
