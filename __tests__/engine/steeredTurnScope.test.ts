import { applyForegroundRetryResend } from '../../src/engine/graph/foregroundConversationReplay';
import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { buildToolSchemaDigest } from '../../src/engine/tools/builtin-tool-schemaDigest';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { windowMessages } from '../../src/services/context/budgetManager';
import { estimateApiMessageCost } from '../../src/services/context/contentTokens';
import { selectContextStartIndex } from '../../src/services/context/contextStartSelector';
import { mcpManager } from '../../src/services/mcp/manager';
import { bindCurrentTurnToolObservedMemoryEvidence } from '../../src/services/memory/toolObservedMemoryEvidence';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';
import { sha256HexUtf8 } from '../../src/utils/sha256';
import { useChatStore } from '../helpers/chatStoreHarness';
import { tools, userMessage } from '../helpers/turnToolSurfaceHarness';

// A message sent while a run works ("steering") is read by that run at its next step and
// continues its turn. Everything scoped to "the current turn" must keep looking back to
// the request that opened it, or a steer silently resets what the run already had.

function steer(id: string, content: string, timestamp: number): Message {
  return { id, role: 'user', content, timestamp, steerOfRunId: 'run-1' };
}

function toolStep(callId: string, name: string, args: string, result: string, at: number) {
  return [
    {
      id: `assistant-${callId}`,
      role: 'assistant' as const,
      content: '',
      timestamp: at,
      toolCalls: [{ id: callId, name, arguments: args, status: 'completed' as const }],
    },
    {
      id: `tool-${callId}`,
      role: 'tool' as const,
      toolCallId: callId,
      content: result,
      timestamp: at + 1,
      toolCalls: [{ id: callId, name, arguments: args, status: 'completed' as const, result }],
    },
  ];
}

describe('tool surface across steers', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps tools the run discovered before it was steered twice', async () => {
    const schema = {
      type: 'object',
      properties: { recordId: { type: 'string' } },
      required: ['recordId'],
    } as const;
    const name = 'mcp__ledger__get_record';
    jest
      .spyOn(mcpManager, 'getAllToolDefinitions')
      .mockReturnValue([{ name, description: 'Read a ledger record.', input_schema: schema }]);
    jest.spyOn(mcpManager, 'getAllStatuses').mockReturnValue([
      {
        id: 'ledger',
        name: 'Ledger',
        state: 'connected',
        lastConnected: 90,
        tools: [{ name: 'get_record', description: 'Read a ledger record.', inputSchema: schema }],
      },
    ]);
    const discovery = JSON.stringify({
      tools: [
        {
          name,
          source: 'mcp',
          schemaDigest: buildToolSchemaDigest(schema),
          activation: { name, eligible: true, callableNow: true },
        },
      ],
    });

    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: [...tools, { name, description: 'Read a ledger record.', input_schema: schema }],
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Reconcile my ledger.', 100),
        ...toolStep('tc-discovery', 'tool_catalog', '{"query":"ledger"}', discovery, 110),
        steer('steer-1', 'Only last month.', 120),
        ...toolStep('tc-read', 'read_file', '{"path":"notes.md"}', '{"content":"x"}', 130),
        steer('steer-2', 'And skip refunds.', 140),
      ],
    });

    expect(selected.map((tool) => tool.name)).toContain(name);
  });
});

describe('tool-observed memory evidence across a steer', () => {
  it('still binds a result the run observed before the steer', () => {
    const result = '{"displayName":"Nour","timezone":"Asia/Amman"}';
    const args = '{"path":"profile.json"}';
    const messages: Message[] = [
      { id: 'request', role: 'user', content: 'Inspect the profile.', timestamp: 1 },
      ...toolStep('tc-profile', 'read_file', args, result, 2),
      steer('steer', 'Remember my timezone.', 4),
    ];

    const capabilities = bindCurrentTurnToolObservedMemoryEvidence({
      executionRunId: 'execution-run-current',
      currentUserMessageId: 'steer',
      workingMessages: messages,
      executedToolDefinitions: TOOL_DEFINITIONS.filter((tool) => tool.name === 'read_file'),
      currentRunCompletedToolResults: [
        {
          executionRunId: 'execution-run-current',
          sourceMessageId: 'tool-tc-profile',
          sourceToolCallId: 'tc-profile',
          sourceToolName: 'read_file',
          argumentsSha256: sha256HexUtf8(args),
          visibleResultSha256: sha256HexUtf8(result),
          visibleResultFidelity: 'complete',
        },
      ],
    });

    expect(capabilities).toHaveLength(1);
  });
});

describe('context start across a steered turn', () => {
  it('never starts the context between a request and its steer', () => {
    const final = (id: string, timestamp: number): Message => ({
      id,
      role: 'assistant',
      content: 'Done.',
      timestamp,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    });
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'First request', timestamp: 1 },
      final('a1', 2),
      { id: 'u2', role: 'user', content: 'Plan the trip', timestamp: 3 },
      ...toolStep('tc-1', 'web_search', '{}', 'ok', 4),
      steer('s2', 'Under 500 euros', 6),
      final('a2', 7),
      { id: 'u3', role: 'user', content: 'Thanks', timestamp: 8 },
    ];

    const selection = selectContextStartIndex(messages, {
      mode: 'chat',
      now: 8,
      policyOverride: { maxCarryoverUserTurns: 1, minRecentUserTurns: 1, hardIdleCutoffMs: 1e9 },
    });

    expect(messages[selection.startIndex]?.id).toBe('u2');
  });
});

describe('budget windowing across a steer', () => {
  it('keeps the request pinned along with the steer that continued it', () => {
    const toolCall = (id: string) => ({
      id,
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    });
    const messages = [
      { role: 'user', content: `Plan the offsite. ${'details '.repeat(400)}` },
      { role: 'assistant', content: '', tool_calls: [toolCall('c1')] },
      { role: 'tool', tool_call_id: 'c1', content: 'x'.repeat(40_000) },
      { role: 'user', content: 'Make it vegetarian.' },
      { role: 'assistant', content: '', tool_calls: [toolCall('c2')] },
      { role: 'tool', tool_call_id: 'c2', content: 'y'.repeat(3_000) },
      { role: 'assistant', content: '', tool_calls: [toolCall('c3')] },
      { role: 'tool', tool_call_id: 'c3', content: 'z' },
    ];
    const cost = (index: number) => estimateApiMessageCost(messages[index]!, 'openai');
    const budget = cost(0) + cost(3) + cost(6) + cost(7) + 50;

    const kept = windowMessages(messages, budget, 'openai');

    expect(kept[0]).toBe(messages[0]);
    expect(kept).toContain(messages[3]);
  });
});

describe('retrying a steered answer', () => {
  it('resends the request with the words of every steer, and drops the steer marker', () => {
    const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
    for (const message of [
      { id: 'request', role: 'user' as const, content: 'Plan the offsite.', timestamp: 1 },
      ...toolStep('tc-1', 'web_search', '{}', 'ok', 2),
      steer('steer', 'Make it vegetarian.', 4),
      { id: 'final', role: 'assistant' as const, content: 'Here is the plan.', timestamp: 5 },
    ]) {
      useChatStore.getState().addMessage(conversationId, message);
    }
    const conversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId) as Conversation;
    const rewind = jest.fn(useChatStore.getState().rewindUserMessageForResend);

    applyForegroundRetryResend({
      actions: {
        cancelConversationRunForRewind: jest.fn(),
        retireConversationSourcesForRewind: jest.fn(),
        rewindUserMessageForResend: rewind,
      },
      assistantMessageId: 'final',
      conversation,
      conversationId,
    });

    expect(rewind).toHaveBeenCalledWith(
      conversationId,
      'request',
      'Plan the offsite.\n\nMake it vegetarian.',
    );
    const messages = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId)!.messages;
    expect(messages.map((message) => message.content)).toEqual([
      'Plan the offsite.\n\nMake it vegetarian.',
    ]);
  });

  it('opens a new turn when an edited steer is resent', () => {
    const conversationId = useChatStore.getState().createConversation('provider-1', 'Be helpful.');
    useChatStore.getState().addMessage(conversationId, {
      id: 'request',
      role: 'user',
      content: 'Plan the offsite.',
      timestamp: 1,
    });
    useChatStore.getState().addMessage(conversationId, steer('steer', 'Vegetarian.', 2));

    useChatStore.getState().rewindUserMessageForResend(conversationId, 'steer', 'Vegan.');

    const resent = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === conversationId)!
      .messages.at(-1);
    expect(resent).toMatchObject({ role: 'user', content: 'Vegan.' });
    expect(resent?.steerOfRunId).toBeUndefined();
  });
});
