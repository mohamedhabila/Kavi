// ---------------------------------------------------------------------------
// Tests — Context Budget Manager
// ---------------------------------------------------------------------------

import {
  computeContextBudget,
  inspectContextBudget,
  truncateSystemPrompt,
  windowMessages,
  enforceContextBudget,
  removeOrphanedToolResults,
  SYSTEM_PROMPT_SHARE,
  TOOL_DEFINITIONS_SHARE,
  MAX_SYSTEM_PROMPT_TOKENS,
  MAX_TOOL_DEFINITION_TOKENS,
} from '../../src/services/context/budgetManager';
import { ToolDefinition } from '../../src/types';

function makeTool(name: string, description = 'Test tool.'): ToolDefinition {
  return {
    name,
    description,
    input_schema: { type: 'object' as const, properties: {} },
  };
}

function makeMessage(role: string, content: string) {
  return { role, content };
}

// ── Budget computation ────────────────────────────────────────────────

describe('computeContextBudget', () => {
  it('computes a budget for a known model', () => {
    const budget = computeContextBudget('gpt-4o', 8192);
    expect(budget.contextWindow).toBeGreaterThan(0);
    expect(budget.outputReserve).toBeGreaterThanOrEqual(8192);
    expect(budget.systemPromptBudget).toBeGreaterThan(0);
    expect(budget.toolsBudget).toBeGreaterThan(0);
    expect(budget.messagesBudget).toBeGreaterThan(0);
  });

  it('system prompt budget does not exceed MAX_SYSTEM_PROMPT_TOKENS', () => {
    const budget = computeContextBudget('gpt-5.4', 16384);
    expect(budget.systemPromptBudget).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_TOKENS);
  });

  it('tools budget does not exceed MAX_TOOL_DEFINITION_TOKENS', () => {
    const budget = computeContextBudget('gpt-5.4', 16384);
    expect(budget.toolsBudget).toBeLessThanOrEqual(MAX_TOOL_DEFINITION_TOKENS);
  });

  it('messages budget is at least 4096', () => {
    const budget = computeContextBudget('phi4-mini', 16384);
    expect(budget.messagesBudget).toBeGreaterThanOrEqual(4096);
  });
});

describe('inspectContextBudget', () => {
  it('detects when messages exceed the real preflight budget before windowing', () => {
    const messages = Array.from({ length: 11 }, (_, index) =>
      makeMessage(index % 2 === 0 ? 'user' : 'assistant', `Message ${index} ${'x'.repeat(2550)}`),
    );

    const pressure = inspectContextBudget('phi4', 'System prompt.', [], messages, 8000);

    expect(pressure.withinBudget).toBe(false);
    expect(pressure.requiresMessageWindowing).toBe(true);
    expect(pressure.messagesTokens).toBeGreaterThan(pressure.remainingMessagesBudget);
    expect(pressure.messageOverflowTokens).toBeGreaterThan(0);
  });
});

// ── System prompt truncation ──────────────────────────────────────────

describe('truncateSystemPrompt', () => {
  it('returns prompt unchanged if within budget', () => {
    const prompt = 'Short prompt.';
    expect(truncateSystemPrompt(prompt, 1000)).toBe(prompt);
  });

  it('truncates long prompts with head+tail strategy', () => {
    const prompt = 'A'.repeat(10000); // ~2857 tokens
    const truncated = truncateSystemPrompt(prompt, 500); // ~1750 chars
    expect(truncated.length).toBeLessThan(prompt.length);
    expect(truncated).toContain('[... context truncated to fit budget ...]');
  });

  it('preserves beginning and end of prompt', () => {
    const prompt = 'START_MARKER ' + 'x'.repeat(10000) + ' END_MARKER';
    const truncated = truncateSystemPrompt(prompt, 500);
    expect(truncated).toContain('START_MARKER');
    expect(truncated).toContain('END_MARKER');
  });
});

// ── Message windowing ─────────────────────────────────────────────────

describe('windowMessages', () => {
  it('returns all messages if within budget', () => {
    const messages = [
      makeMessage('system', 'You are helpful.'),
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi!'),
    ];
    const result = windowMessages(messages, 100000);
    expect(result.length).toBe(3);
  });

  it('keeps system message and most recent messages when over budget', () => {
    const messages = [
      makeMessage('system', 'System prompt.'),
      makeMessage('user', 'Old message 1.'),
      makeMessage('assistant', 'Old response 1.'),
      makeMessage('user', 'Old message 2.'),
      makeMessage('assistant', 'Old response 2.'),
      makeMessage('user', 'Recent question.'),
    ];
    // Very tight budget: should keep system + most recent
    const result = windowMessages(messages, 20);
    expect(result[0].role).toBe('system');
    // Should include the most recent message
    const contents = result.map((m) => m.content);
    expect(contents).toContain('Recent question.');
    expect(result.length).toBeLessThan(messages.length);
  });

  it('returns empty for empty input', () => {
    expect(windowMessages([], 1000).length).toBe(0);
  });

  it('preserves the latest user request even when a newer tool result follows it', () => {
    const oversizedUser = `Latest user request ${'x'.repeat(4000)}`;
    const messages = [
      makeMessage('system', 'System prompt.'),
      makeMessage('assistant', 'Older response.'),
      makeMessage('user', oversizedUser),
      makeMessage('tool', 'Tool result that follows the user request.'),
    ];

    const result = windowMessages(messages as any, 200);
    const contents = result.map((message) => message.content);
    expect(contents).toContain(oversizedUser);
    expect(contents).toContain('Tool result that follows the user request.');
  });

  it('keeps Anthropic tool_use assistant blocks grouped with their tool results', () => {
    const messages = [
      makeMessage('system', 'System prompt.'),
      makeMessage('user', 'Earlier request.'),
      makeMessage('assistant', 'Older response.'),
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need to inspect a file.', signature: 'sig_123' },
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'read_file',
            input: { path: '/tmp/test.txt' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'file contents',
        tool_call_id: 'toolu_123',
        name: 'read_file',
      },
    ];

    const result = windowMessages(messages as any, 40);
    expect(result).toContainEqual(messages[3]);
    expect(result).toContainEqual(messages[4]);
  });
});

describe('removeOrphanedToolResults', () => {
  it('preserves Anthropic tool results when the assistant content includes tool_use blocks', () => {
    const messages = [
      makeMessage('user', 'Inspect the file.'),
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should read the file first.', signature: 'sig_abc' },
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'read_file',
            input: { path: '/tmp/test.txt' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'file contents',
        tool_call_id: 'toolu_abc',
        name: 'read_file',
      },
      makeMessage('assistant', 'The file is readable.'),
    ];

    const result = removeOrphanedToolResults(messages as any);
    expect(result).toHaveLength(messages.length);
    expect(result).toContainEqual(messages[2]);
  });

  it('preserves OpenAI tool results when the assistant replay contains function_call items', () => {
    const messages = [
      makeMessage('user', 'Inspect the file.'),
      {
        role: 'assistant',
        content: '',
        providerReplay: {
          openaiResponseOutput: [
            {
              id: 'fc_abc',
              type: 'function_call',
              call_id: 'call_abc',
              name: 'read_file',
              arguments: '{"path":"/tmp/test.txt"}',
            },
          ],
        },
      },
      {
        role: 'tool',
        content: 'file contents',
        tool_call_id: 'call_abc',
        name: 'read_file',
      },
      makeMessage('assistant', 'The file is readable.'),
    ];

    const result = removeOrphanedToolResults(messages as any);
    expect(result).toHaveLength(messages.length);
    expect(result).toContainEqual(messages[2]);
  });
});

// ── Pre-flight budget enforcement ─────────────────────────────────────

describe('enforceContextBudget', () => {
  it('returns payload unchanged if everything fits', () => {
    const prompt = 'You are helpful.';
    const tools = [makeTool('read_file')];
    const messages = [makeMessage('system', prompt), makeMessage('user', 'Hello')];

    const result = enforceContextBudget('gpt-5.4', prompt, tools, messages, 8192);
    expect(result.result.adjustments.length).toBe(0);
    expect(result.tools.length).toBe(1);
    expect(result.messages.length).toBe(2);
  });

  it('compresses tools when tool definitions are too large', () => {
    const prompt = 'System.';
    // Generate tools with verbose descriptions
    const tools = Array.from({ length: 100 }, (_, i) =>
      makeTool(
        `tool_${i}`,
        `This is a very long description for tool ${i}. It goes on and on explaining everything. Then it adds more detail that nobody needs. Plus extra guidance that is redundant.`,
      ),
    );
    const messages = [makeMessage('user', 'Hello')];

    const result = enforceContextBudget('phi4-mini', prompt, tools, messages, 4096);
    // Should have made some adjustments for a 16K model with 100 tools
    expect(result.result.totalTokens).toBeLessThanOrEqual(
      result.result.budget.contextWindow - result.result.budget.outputReserve,
    );
  });

  it('preserves pinned continuation tools during pre-flight trimming', () => {
    const prompt = 'System.';
    const tools = [
      makeTool('read_file', 'Tier 1 tool.'),
      makeTool('web_fetch', 'Pinned continuation tool.'),
      ...Array.from({ length: 80 }, (_, index) =>
        makeTool(
          `extra_tool_${index}`,
          `Verbose tool ${index}. ${'This tool has a long description. '.repeat(12)}`,
        ),
      ),
    ];
    const messages = [makeMessage('user', 'Try again')];

    const result = enforceContextBudget('phi4-mini', prompt, tools, messages, 4096, {
      pinnedToolNames: ['web_fetch'],
    });

    expect(result.tools.some((tool) => tool.name === 'web_fetch')).toBe(true);
  });

  it('windows messages when conversation history is too long', () => {
    const prompt = 'System prompt that is fairly standard in length.';
    const tools = [makeTool('a')];
    // Generate a very long conversation — each message ~200 chars (~57 tokens)
    const messages = [
      makeMessage('system', prompt),
      ...Array.from({ length: 200 }, (_, i) =>
        makeMessage(
          i % 2 === 0 ? 'user' : 'assistant',
          `Message ${i}: ${'x'.repeat(200)} end of message ${i}.`,
        ),
      ),
    ];

    const result = enforceContextBudget('phi4-mini', prompt, tools, messages, 4096);
    expect(result.messages.length).toBeLessThan(messages.length);
    // Most recent messages should be preserved
    const lastContent = result.messages[result.messages.length - 1].content;
    expect(typeof lastContent === 'string' && lastContent.includes('Message 199')).toBe(true);
  });

  it('handles zero tools gracefully', () => {
    const prompt = 'System.';
    const messages = [makeMessage('user', 'Hello')];

    const result = enforceContextBudget('gpt-5.4', prompt, [], messages, 8192);
    expect(result.tools.length).toBe(0);
    expect(result.result.toolsTokens).toBe(0);
  });

  it('removes orphaned tool results even when the message list already fits budget', () => {
    const prompt = 'System.';
    const messages = [
      makeMessage('user', 'Read the file.'),
      {
        role: 'tool',
        content: 'Error: file not found',
        tool_call_id: 'tc_orphan',
        name: 'read_file',
      },
      makeMessage('assistant', 'I could not read that file.'),
    ];

    const result = enforceContextBudget(
      'gemini-3.1-pro-preview',
      prompt,
      [],
      messages as any,
      8192,
    );
    expect(result.messages.some((message) => message.role === 'tool')).toBe(false);
    expect(result.result.adjustments).toContain('removed 1 orphaned tool results');
  });
});
