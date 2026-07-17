// ---------------------------------------------------------------------------
// Tests — Deterministic (Structural) Memory Extractor
// ---------------------------------------------------------------------------
// Pure function tests: no mocks, no SQLite, no natural-language heuristics.
// Semantic fallback is content-free; only verified tool evidence may create facts.
// ---------------------------------------------------------------------------

import {
  extractStructuralMemory,
  sliceClosedTurnMessages,
} from '../../../src/services/memory/deterministicExtractor';
import type { Message } from '../../../src/types/message';
import {
  decodeIngestionSourceSnapshot,
  encodeIngestionSourceSnapshot,
} from '../../../src/services/memory/ingestionSourceSnapshot';

function msg(overrides: Partial<Message> = {}): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as Message;
}

const baseInput = {
  userMessage: 'Build the API',
  assistantMessage: 'Done.',
  conversationId: 'conv-1',
  threadId: 'conv-1',
};

// ── Episode summary ─────────────────────────────────────────────────────────

describe('extractStructuralMemory — episode summary', () => {
  function descriptor(result: ReturnType<typeof extractStructuralMemory>) {
    return JSON.parse(result.episodeSummary) as Record<string, unknown>;
  }

  it('persists only content-free turn structure and completed tool counts', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      userMessage: 'secret user prose must never be copied',
      messages: [
        msg({ role: 'user', content: 'secret user prose must never be copied' }),
        msg({
          role: 'assistant',
          content: 'secret assistant prose must never be copied',
          toolCalls: [{ id: 'call-1', name: 'execute_shell', arguments: '{}' }],
        }),
        msg({ role: 'tool', toolCallId: 'call-1', content: 'secret tool result' }),
      ],
    });

    expect(descriptor(result)).toEqual({
      kind: 'structural_turn',
      version: 1,
      messageCount: 3,
      toolCallCount: 1,
      completedToolCallCount: 1,
      hasCodeBlock: false,
      hasAttachments: false,
    });
    expect(result.episodeSummary).not.toContain('secret');
    expect(result.episodeSummary).not.toContain('execute_shell');
  });

  it('records only code-block presence', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [msg({ role: 'assistant', content: '```typescript\nconst secret = 1;\n```' })],
    });
    expect(descriptor(result)).toMatchObject({ hasCodeBlock: true });
    expect(result.episodeSummary).not.toContain('typescript');
    expect(result.episodeSummary).not.toContain('secret');
  });

  it('records only attachment presence', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'user',
          content: 'See this',
          attachments: [{ uri: 'file:///img.png', type: 'image' }],
        }),
      ],
    });
    expect(descriptor(result)).toMatchObject({ hasAttachments: true });
    expect(result.episodeSummary).not.toContain('file:///img.png');
  });

  it('preserves attachment presence from a content-minimal ingestion snapshot', () => {
    const messages: Message[] = [
      {
        id: 'user-snapshot-attachment',
        role: 'user',
        content: 'Review this attachment.',
        timestamp: 1,
        attachments: [
          {
            id: 'attachment-1',
            type: 'file',
            uri: 'file:///private/source.pdf',
            name: 'source.pdf',
            mimeType: 'application/pdf',
            size: 10,
          },
        ],
      },
      {
        id: 'assistant-snapshot-attachment',
        role: 'assistant',
        content: 'Reviewed.',
        timestamp: 2,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
      },
    ];
    const snapshot = decodeIngestionSourceSnapshot(
      encodeIngestionSourceSnapshot({
        messages,
        priorUserMessageId: null,
        sourceStartMessageId: 'user-snapshot-attachment',
        sourceEndMessageId: 'assistant-snapshot-attachment',
      }),
    );

    expect(snapshot.turnMessages[0]).toMatchObject({ hasAttachments: true });
    expect(
      descriptor(extractStructuralMemory({ ...baseInput, messages: snapshot.turnMessages })),
    ).toMatchObject({ hasAttachments: true });
  });

  it('uses the same closed descriptor when no optional signals exist', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      userMessage: '',
      assistantMessage: '',
      messages: [],
    });
    expect(descriptor(result)).toEqual({
      kind: 'structural_turn',
      version: 1,
      messageCount: 0,
      toolCallCount: 0,
      completedToolCallCount: 0,
      hasCodeBlock: false,
      hasAttachments: false,
    });
  });
});

// ── Turn window slicing ─────────────────────────────────────────────────────

describe('sliceClosedTurnMessages', () => {
  it('returns only messages between the closed user and assistant ids', () => {
    const user = msg({ id: 'u-2', role: 'user', content: 'second' });
    const assistant = msg({
      id: 'a-2',
      role: 'assistant',
      content: 'acknowledged',
    });
    const messages = [
      msg({ id: 'u-1', role: 'user', content: 'first' }),
      msg({
        id: 'a-1',
        role: 'assistant',
        toolCalls: [{ name: 'update_goals', arguments: '{}' }],
      }),
      user,
      assistant,
    ];

    expect(sliceClosedTurnMessages(messages, 'u-2', 'a-2').map((message) => message.id)).toEqual([
      'u-2',
      'a-2',
    ]);
  });
});

// ── Content-free semantic fallback ─────────────────────────────────────────

describe('extractStructuralMemory — semantic fallback', () => {
  it('uses only the closed turn window for its content-free descriptor', () => {
    const user = msg({ id: 'u-2', role: 'user', content: 'recall scope-b' });
    const assistant = msg({ id: 'a-2', role: 'assistant', content: 'acknowledged' });
    const result = extractStructuralMemory({
      ...baseInput,
      userMessage: 'recall scope-b',
      assistantMessage: 'acknowledged',
      sourceUserMessageId: 'u-2',
      sourceAssistantMessageId: 'a-2',
      messages: [
        msg({ id: 'u-1', role: 'user', content: 'switch goal' }),
        msg({
          id: 'a-1',
          role: 'assistant',
          toolCalls: [{ name: 'update_goals', arguments: '{}' }],
        }),
        user,
        assistant,
      ],
    });

    expect(result.episodeSummary).not.toContain('update_goals');
    expect(JSON.parse(result.episodeSummary)).toMatchObject({
      messageCount: 2,
      toolCallCount: 0,
    });
  });

  it.each([
    ['tool metadata', 'Run this', 'write_file'],
    ['code fence', '```python\nprint(1)\n```', null],
    ['Western checklist', '- [ ] Fix auth\n1. Update docs', null],
    ['Arabic list', '١. راجع الموعد\n- [ ] اتصل بالطبيب', null],
    ['Japanese list', '1. 予定を確認\n- [ ] 予約する', null],
  ])('does not infer focus or open threads from %s', (_label, content, toolName) => {
    const result = extractStructuralMemory({
      ...baseInput,
      threadTitle: 'private title',
      messages: [
        msg({
          role: toolName ? 'assistant' : 'user',
          content,
          toolCalls: toolName ? [{ name: toolName, arguments: '{}' }] : undefined,
        }),
      ],
    });

    expect(result.episodeSummary).not.toContain('private title');
    expect(result.episodeSummary).not.toContain(content);
    if (toolName) expect(result.episodeSummary).not.toContain(toolName);
  });
});

// ── Structural facts ────────────────────────────────────────────────────────

describe('extractStructuralMemory — structural facts', () => {
  it('does not duplicate writes already owned by the memory_remember executor', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              name: 'memory_remember',
              arguments: JSON.stringify({
                subject: 'knowu-user',
                predicate: 'preferred_message_contact',
                value: 'Avery',
                scope: 'global',
                confidence: 0.92,
                importance: 0.8,
              }),
            },
          ],
        }),
      ],
    });

    expect(result.facts).toEqual([]);
  });

  it('does not turn generic JSON tool responses into semantic facts', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'tool',
          content: '{"status": "success", "files": 3}',
          toolCalls: [{ name: 'list_files', arguments: '{}' }],
        }),
      ],
    });
    const fact = result.facts.find((f) => f.predicate === 'tool_result');
    expect(fact).toBeUndefined();
  });

  it('skips non-JSON tool responses', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'tool',
          content: 'The file has been updated successfully.',
          toolCalls: [{ name: 'write_file', arguments: '{}' }],
        }),
      ],
    });
    const fact = result.facts.find((f) => f.predicate === 'tool_result');
    expect(fact).toBeUndefined();
  });

  it('extracts file operation facts only from calls with an exact tool result', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'file-edit-1',
              name: 'file_edit',
              arguments: JSON.stringify({ path: '/src/app.ts' }),
            },
          ],
        }),
        msg({ id: 'file-edit-result-1', role: 'tool', toolCallId: 'file-edit-1', content: 'ok' }),
      ],
    });
    const fact = result.facts.find((f) => f.predicate === 'file_operation');
    expect(fact).toBeDefined();
    expect(fact!.value).toContain('/src/app.ts');
    expect(fact).toMatchObject({
      evidenceMessageIds: ['file-edit-result-1'],
      sealedApplicability: { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    });
  });

  it('does not treat an unobserved tool request as a completed structural fact', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'assistant',
          toolCalls: [
            {
              id: 'unobserved-edit',
              name: 'file_edit',
              arguments: JSON.stringify({ path: '/src/app.ts' }),
            },
          ],
        }),
      ],
    });
    expect(result.facts).toEqual([]);
  });

  it('never persists delegated prompt prose as a structural fact', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'spawn-1',
              name: 'sessions_spawn',
              arguments: JSON.stringify({ prompt: 'private delegated prompt' }),
            },
          ],
        }),
        msg({ id: 'spawn-result-1', role: 'tool', toolCallId: 'spawn-1', content: 'created' }),
      ],
    });
    expect(result.facts).toEqual([]);
    expect(result.episodeSummary).not.toContain('private delegated prompt');
  });

  it('caps facts at 5 items', () => {
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(
        msg({
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: `file-edit-${i}`,
              name: 'file_edit',
              arguments: JSON.stringify({ path: `/file${i}.ts` }),
            },
          ],
        }),
        msg({
          id: `file-edit-result-${i}`,
          role: 'tool',
          toolCallId: `file-edit-${i}`,
          content: 'ok',
        }),
      );
    }
    const result = extractStructuralMemory({
      ...baseInput,
      messages,
    });
    expect(result.facts.length).toBeLessThanOrEqual(5);
  });

  it('ignores plain text messages with no structural signals', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({ role: 'user', content: 'Hello, how are you?' }),
        msg({ role: 'assistant', content: 'I am fine, thank you.' }),
      ],
    });
    expect(result.facts).toEqual([]);
  });
});
