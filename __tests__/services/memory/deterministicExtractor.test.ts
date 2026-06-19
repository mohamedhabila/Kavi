// ---------------------------------------------------------------------------
// Tests — Deterministic (Structural) Memory Extractor
// ---------------------------------------------------------------------------
// Pure function tests: no mocks, no SQLite, no English heuristics.
// All extraction is structural (tool metadata, code blocks, markdown syntax).
// ---------------------------------------------------------------------------

import {
  extractStructuralMemory,
  sliceClosedTurnMessages,
} from '../../../src/services/memory/deterministicExtractor';
import type { Message } from '../../../src/types/message';

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
  it('includes user message preview and tool names', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      userMessage: 'Deploy to staging',
      messages: [
        msg({ role: 'user', content: 'Deploy to staging' }),
        msg({
          role: 'assistant',
          content: 'OK',
          toolCalls: [{ name: 'execute_shell', arguments: '{}' }],
        }),
      ],
    });
    expect(result.episodeSummary).toContain('Deploy to staging');
    expect(result.episodeSummary).toContain('[execute_shell]');
  });

  it('marks [code] when code blocks are present', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [msg({ role: 'assistant', content: '```typescript\nconst x = 1;\n```' })],
    });
    expect(result.episodeSummary).toContain('[code]');
  });

  it('marks [attachments] when messages have attachments', () => {
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
    expect(result.episodeSummary).toContain('[attachments]');
  });

  it('falls back to "Turn completed" when no signals exist', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      userMessage: '',
      assistantMessage: '',
      messages: [],
    });
    expect(result.episodeSummary).toBe('Turn completed');
  });

  it('caps episode summary at 600 chars', () => {
    const longUser = 'a'.repeat(1000);
    const result = extractStructuralMemory({
      ...baseInput,
      userMessage: longUser,
      messages: [
        msg({
          role: 'assistant',
          toolCalls: [{ name: 'very_long_tool_name_that_adds_more_chars', arguments: '{}' }],
        }),
      ],
    });
    expect(result.episodeSummary.length).toBeLessThanOrEqual(600);
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

// ── Focus inference ─────────────────────────────────────────────────────────

describe('extractStructuralMemory — focus inference', () => {
  it('uses only the closed turn window when source message ids are provided', () => {
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

    expect(result.activeFocus).toBeNull();
    expect(result.episodeSummary).not.toContain('update_goals');
  });
  it('infers focus from tool calls', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [msg({ role: 'assistant', toolCalls: [{ name: 'write_file', arguments: '{}' }] })],
    });
    expect(result.activeFocus).toContain('Running:');
    expect(result.activeFocus).toContain('write_file');
  });

  it('infers focus from code blocks with languages', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({ role: 'assistant', content: '```python\nprint(1)\n```\n```rust\nfn main(){}\n```' }),
      ],
    });
    expect(result.activeFocus).toContain('Coding:');
    expect(result.activeFocus).toContain('python');
    expect(result.activeFocus).toContain('rust');
  });

  it('prefers thread title prefix when available', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      threadTitle: 'API Refactor',
      messages: [msg({ role: 'assistant', toolCalls: [{ name: 'read_file', arguments: '{}' }] })],
    });
    expect(result.activeFocus).toContain('API Refactor');
    expect(result.activeFocus).toContain('Running:');
  });

  it('falls back to thread title alone when no tools or code', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      threadTitle: 'Daily standup notes',
      messages: [msg({ role: 'user', content: 'Hello' })],
    });
    expect(result.activeFocus).toContain('Daily standup notes');
  });

  it('returns null when no structural signals exist', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [msg({ role: 'user', content: 'Hello' })],
    });
    expect(result.activeFocus).toBeNull();
  });

  it('caps focus at 600 chars', () => {
    const longTitle = 'A'.repeat(1000);
    const result = extractStructuralMemory({
      ...baseInput,
      threadTitle: longTitle,
      messages: [msg({ role: 'assistant', toolCalls: [{ name: 'x', arguments: '{}' }] })],
    });
    expect(result.activeFocus!.length).toBeLessThanOrEqual(600);
  });
});

// ── Open threads ────────────────────────────────────────────────────────────

describe('extractStructuralMemory — open threads', () => {
  it('extracts unchecked markdown checklist items', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({ role: 'assistant', content: '- [ ] Fix auth\n- [x] Done item\n- [ ] Update docs' }),
      ],
    });
    expect(result.openThreads).toContain('Fix auth');
    expect(result.openThreads).toContain('Update docs');
    expect(result.openThreads).not.toContain('Done item');
  });

  it('extracts numbered list items as potential steps', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({ role: 'assistant', content: '1. First step\n2. Second step\n3. Third step' }),
      ],
    });
    expect(result.openThreads).toContain('First step');
    expect(result.openThreads).toContain('Second step');
  });

  it('caps open threads at 5 items', () => {
    const items = Array.from({ length: 10 }, (_, i) => `- [ ] Task ${i}`).join('\n');
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [msg({ role: 'assistant', content: items })],
    });
    expect(result.openThreads.length).toBeLessThanOrEqual(5);
  });

  it('drops very short or very long items', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [msg({ role: 'assistant', content: '- [ ] OK\n- [ ] ' + 'x'.repeat(100) })],
    });
    expect(result.openThreads).toHaveLength(0);
  });

  it('returns empty array when no checklist or numbered list exists', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [msg({ role: 'assistant', content: 'Just some text' })],
    });
    expect(result.openThreads).toEqual([]);
  });
});

// ── Structural facts ────────────────────────────────────────────────────────

describe('extractStructuralMemory — structural facts', () => {
  it('extracts exact facts from memory_remember tool calls', () => {
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

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: 'knowu-user',
          predicate: 'preferred_message_contact',
          value: 'Avery',
          scope: 'global',
          confidence: 0.92,
          importance: 0.8,
        }),
      ]),
    );
  });

  it('extracts tool result facts from JSON tool responses', () => {
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
    expect(result.facts.length).toBeGreaterThan(0);
    const fact = result.facts.find((f) => f.predicate === 'tool_result');
    expect(fact).toBeDefined();
    expect(fact!.value).toContain('list_files');
    expect(fact!.scope).toBe('conversation');
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

  it('extracts file operation facts from known file tool names', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'assistant',
          content: '',
          toolCalls: [{ name: 'file_edit', arguments: JSON.stringify({ path: '/src/app.ts' }) }],
        }),
      ],
    });
    const fact = result.facts.find((f) => f.predicate === 'file_operation');
    expect(fact).toBeDefined();
    expect(fact!.value).toContain('/src/app.ts');
  });

  it('extracts sub-agent delegation facts', () => {
    const result = extractStructuralMemory({
      ...baseInput,
      messages: [
        msg({
          role: 'assistant',
          content: '',
          toolCalls: [
            { name: 'sessions_spawn', arguments: JSON.stringify({ prompt: 'Write tests' }) },
          ],
        }),
      ],
    });
    const fact = result.facts.find((f) => f.predicate === 'delegated_task');
    expect(fact).toBeDefined();
    expect(fact!.value).toContain('Write tests');
  });

  it('caps facts at 5 items', () => {
    const messages: Message[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(
        msg({
          role: 'assistant',
          content: '',
          toolCalls: [{ name: 'file_edit', arguments: JSON.stringify({ path: `/file${i}.ts` }) }],
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
