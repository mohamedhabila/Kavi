// ---------------------------------------------------------------------------
// Tests — Gemini multi-turn thought signature replay continuity (RC-6)
// ---------------------------------------------------------------------------

import { formatMessagesForApi } from '../../src/engine/orchestratorMessageFormatting';
import { buildGeminiConversation } from '../../src/services/llm/providers/gemini/conversation';
import { hasGeminiToolTurnThoughtSignatureCoverage } from '../../src/services/llm/providers/gemini/thoughtSignatureCoverage';
import type { Message } from '../../src/types/message';

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: '',
    timestamp: Date.now(),
    ...overrides,
  } as Message;
}

describe('Gemini multi-turn thought signature replay', () => {
  it('rehydrates turn-1 signatures from providerReplay when tool raw metadata was stripped', async () => {
    const turnOneAssistant = msg({
      id: 'a-1',
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'tc-1',
          name: 'write_file',
          arguments: '{"path":"artifacts/chain-seed.txt","content":"CHAIN-SEED-E2E"}',
          status: 'completed',
        },
      ],
      providerReplay: {
        geminiParts: [
          {
            functionCall: {
              name: 'write_file',
              args: {
                path: 'artifacts/chain-seed.txt',
                content: 'CHAIN-SEED-E2E',
              },
            },
            thoughtSignature: 'sig-turn-1',
          },
        ],
      },
    });
    const messages = [
      msg({ id: 'u-1', role: 'user', content: 'Seed the chain file' }),
      turnOneAssistant,
      msg({
        id: 't-1',
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: 'tc-1',
      }),
      msg({ id: 'u-2', role: 'user', content: 'Continue the chain' }),
    ];

    const apiMessages = await formatMessagesForApi('You are helpful.', messages);
    const assistantReplay = apiMessages.find((entry) => entry.role === 'assistant');
    expect(assistantReplay?.tool_calls?.[0]?.extra_content?.google?.thought_signature).toBe(
      'sig-turn-1',
    );

    const conversation = buildGeminiConversation(
      'gemini-3.5-flash',
      apiMessages.filter((entry) => entry.role !== 'system') as any,
    );
    const modelParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts);
    expect(modelParts[0]?.thoughtSignature).toBe('sig-turn-1');
  });

  it('passes turn-2 coverage when replay parts carry the first function-call signature', () => {
    const turnTwoReplay = {
      geminiParts: [
        {
          text: 'Planning next tool',
          thought: true,
          thoughtSignature: 'sig-thought-2',
        },
        {
          functionCall: {
            name: 'read_file',
            args: { path: 'artifacts/chain-seed.txt' },
          },
          thoughtSignature: 'sig-thought-2',
        },
      ],
    };

    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [
          {
            raw: {
              id: 'tc-2',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"artifacts/chain-seed.txt"}',
              },
            },
          },
        ],
        providerReplay: turnTwoReplay,
      }),
    ).toBe(true);
  });

  it('requires only the first parallel function call to carry a capturable signature', () => {
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ raw: { thoughtSignature: 'sig-a' } }, { raw: {} }],
        providerReplay: {
          geminiParts: [
            {
              functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-a' } },
              thoughtSignature: 'sig-a',
            },
            { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-b' } } },
          ],
        },
      }),
    ).toBe(true);

    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ raw: {} }, { raw: {} }],
        providerReplay: {
          geminiParts: [
            { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-a' } } },
            { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-b' } } },
          ],
        },
      }),
    ).toBe(false);
  });

  it('rehydrates a three-user-turn memory chain before turn-3 provider request', async () => {
    const rememberA = msg({
      id: 'a-1',
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'tc-remember-a',
          name: 'memory_remember',
          arguments: '{"subject":"e2e-state-a","predicate":"pref_color","value":"COLOR-E2E-A"}',
          status: 'completed',
        },
      ],
      providerReplay: {
        geminiParts: [
          {
            functionCall: {
              name: 'memory_remember',
              args: {
                subject: 'e2e-state-a',
                predicate: 'pref_color',
                value: 'COLOR-E2E-A',
              },
            },
            thoughtSignature: 'sig-remember-a',
          },
        ],
      },
    });
    const rememberB = msg({
      id: 'a-2',
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'tc-remember-b',
          name: 'memory_remember',
          arguments: '{"subject":"e2e-state-b","predicate":"pref_color","value":"COLOR-E2E-B"}',
          status: 'completed',
        },
      ],
      providerReplay: {
        geminiParts: [
          {
            functionCall: {
              name: 'memory_remember',
              args: {
                subject: 'e2e-state-b',
                predicate: 'pref_color',
                value: 'COLOR-E2E-B',
              },
            },
            thoughtSignature: 'sig-remember-b',
          },
        ],
      },
    });

    const messages = [
      msg({
        id: 'u-1',
        role: 'user',
        content:
          'Call memory_remember with subject `e2e-state-a`, predicate `pref_color`, value `COLOR-E2E-A`.',
      }),
      rememberA,
      msg({
        id: 't-1',
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: 'tc-remember-a',
      }),
      msg({
        id: 'u-2',
        role: 'user',
        content:
          'Call memory_remember with subject `e2e-state-b`, predicate `pref_color`, value `COLOR-E2E-B`.',
      }),
      rememberB,
      msg({
        id: 't-2',
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: 'tc-remember-b',
      }),
      msg({
        id: 'u-3',
        role: 'user',
        content:
          'Call memory_recall with subject `e2e-state-a`, then memory_recall with subject `e2e-state-b`.',
      }),
    ];

    const apiMessages = await formatMessagesForApi('You are helpful.', messages);
    const conversation = buildGeminiConversation(
      'gemini-3.5-flash',
      apiMessages.filter((entry) => entry.role !== 'system') as any,
    );

    const modelFunctionCallParts = conversation.contents
      .filter((entry) => entry.role === 'model')
      .flatMap((entry) => entry.parts)
      .filter((part) => part.functionCall);

    expect(modelFunctionCallParts).toHaveLength(2);
    expect(modelFunctionCallParts[0]?.thoughtSignature).toBe('sig-remember-a');
    expect(modelFunctionCallParts[1]?.thoughtSignature).toBe('sig-remember-b');

    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ raw: { thoughtSignature: 'sig-recall-a' } }, { raw: {} }],
        providerReplay: {
          geminiParts: [
            {
              functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-a' } },
              thoughtSignature: 'sig-recall-a',
            },
            { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-b' } } },
          ],
        },
      }),
    ).toBe(true);
  });

  it('emits thought signatures only on the first parallel tool call in API replay', async () => {
    const assistant = msg({
      id: 'a-parallel',
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'tc-a',
          name: 'memory_recall',
          arguments: '{"subject":"e2e-state-a"}',
          status: 'completed',
        },
        {
          id: 'tc-b',
          name: 'memory_recall',
          arguments: '{"subject":"e2e-state-b"}',
          status: 'completed',
        },
      ],
      providerReplay: {
        geminiParts: [
          {
            functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-a' } },
            thoughtSignature: 'sig-first',
          },
          { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-b' } } },
        ],
      },
    });

    const apiMessages = await formatMessagesForApi('You are helpful.', [
      msg({ id: 'u-1', role: 'user', content: 'Recall both states.' }),
      assistant,
    ]);
    const assistantReplay = apiMessages.find((entry) => entry.role === 'assistant');
    expect(assistantReplay?.tool_calls?.[0]?.extra_content?.google?.thought_signature).toBe(
      'sig-first',
    );
    expect(
      assistantReplay?.tool_calls?.[1]?.extra_content?.google?.thought_signature,
    ).toBeUndefined();
    expect(assistantReplay?.tool_calls?.[1]?.thoughtSignature).toBeUndefined();
  });

  it('passes coverage when only a non-adjacent orphan signature carrier is present', () => {
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ raw: {} }, { raw: {} }],
        providerReplay: {
          geminiParts: [
            { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-a' } } },
            { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-b' } } },
            { text: '', thoughtSignature: 'sig-orphan' },
          ],
        },
      }),
    ).toBe(true);
  });

  it('passes coverage when a thought part carries the step signature before the function call', () => {
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [
          {
            raw: {
              id: 'tc-step-2',
              type: 'function',
              function: {
                name: 'list_files',
                arguments: '{"path":"artifacts/"}',
              },
            },
          },
        ],
        providerReplay: {
          geminiParts: [
            { text: 'plan', thought: true, thoughtSignature: 'sig-thought-step' },
            {
              functionCall: { name: 'list_files', args: { path: 'artifacts/' } },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('fails turn-2 coverage when replay and raw both lack signatures', () => {
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [
          {
            raw: {
              id: 'tc-2',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"artifacts/chain-seed.txt"}',
              },
            },
          },
        ],
        providerReplay: {
          geminiParts: [
            {
              functionCall: {
                name: 'read_file',
                args: { path: 'artifacts/chain-seed.txt' },
              },
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
