jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { parseToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import {
  AGENT_RUN_TERMINAL_EVIDENCE_PREFIX,
  buildAgentRunTerminalEvidence,
  collectAgentRunMemoryEvidence,
  decodeAgentRunTerminalEvidence,
  parseAgentRunTerminalEvidence,
} from '../../../src/services/memory/agentRunTerminalEvidence';
import type { AgentRun } from '../../../src/types/agentRun';
import type { Message, ToolCall } from '../../../src/types/message';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

const DIGEST = `sha256:${'1'.repeat(64)}` as const;

function completedRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    goal: 'Create the requested calendar event',
    status: 'completed',
    controlGraph: {
      status: 'finalized',
      observedToolResults: [{ id: 'call-1', name: 'calendar_create_event' }],
    },
    ...overrides,
  } as AgentRun;
}

function receipt(
  toolCallId: string,
  toolName: string,
  overrides: Partial<ToolEffectReceipt> = {},
): ToolEffectReceipt {
  return {
    version: 2,
    receiptId: `ter_${toolCallId.replace(/[^0-9]/gu, '').padStart(32, '0')}`,
    toolCallId,
    toolName,
    contractIdentity: {
      kind: 'code_owned',
      version: 1,
      toolName,
      schemaDigest: DIGEST,
      capabilityContractDigest: DIGEST,
      workflowContractDigest: DIGEST,
      effectContractDigest: DIGEST,
      executionPolicyDigest: DIGEST,
    },
    executionRunId: 'request-1',
    transportState: 'returned',
    effectKind: 'calendar.create',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: DIGEST,
    resultDigest: DIGEST,
    recordedAt: 10,
    ...overrides,
  };
}

function toolCall(id: string, name: string, effectReceipts?: ToolEffectReceipt[]): ToolCall {
  return {
    id,
    name,
    arguments: '{}',
    status: 'completed',
    result: 'ok',
    ...(effectReceipts ? { effectReceipts } : {}),
  };
}

function assistantWithToolCalls(id: string, toolCalls: ToolCall[]): Message {
  return { id, role: 'assistant', content: '', timestamp: 2, toolCalls } as Message;
}

const TURN_USER: Message = { id: 'user-1', role: 'user', content: 'Book it', timestamp: 1 };

describe('agent-run terminal evidence', () => {
  it('encodes and parses completion the run and its graph agree on', () => {
    const encoded = buildAgentRunTerminalEvidence(completedRun());

    expect(encoded).toMatch(new RegExp(`^${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}`));
    expect(parseAgentRunTerminalEvidence(encoded!)).toEqual({
      version: 2,
      sourceRunId: 'run-1',
      goal: 'Create the requested calendar event',
      runStatus: 'completed',
      graphStatus: 'finalized',
      platform: 'ios',
      observedToolCallIds: ['call-1'],
    });
  });

  it('does not issue terminal proof for an unfinished run or graph', () => {
    expect(
      buildAgentRunTerminalEvidence(
        completedRun({
          controlGraph: { ...completedRun().controlGraph!, status: 'awaiting_review' },
        }),
      ),
    ).toBeNull();
    expect(buildAgentRunTerminalEvidence(completedRun({ status: 'failed' }))).toBeNull();
    expect(
      buildAgentRunTerminalEvidence(
        completedRun({ controlGraph: { status: 'finalized' } as AgentRun['controlGraph'] }),
      ),
    ).toBeNull();
  });

  it('still decodes the version 1 proof persisted memory holds, without its goal count', () => {
    const legacy = {
      version: 1,
      sourceRunId: 'run-1',
      goal: 'Create the requested calendar event',
      runStatus: 'completed',
      graphStatus: 'finalized',
      platform: 'android',
      completedBlockingGoalCount: 2,
      observedToolCallIds: ['call-1'],
    };

    expect(decodeAgentRunTerminalEvidence(legacy)).toEqual({
      version: 2,
      sourceRunId: 'run-1',
      goal: 'Create the requested calendar event',
      runStatus: 'completed',
      graphStatus: 'finalized',
      platform: 'android',
      observedToolCallIds: ['call-1'],
    });
    const { completedBlockingGoalCount: _count, ...legacyWithoutCount } = legacy;
    expect(decodeAgentRunTerminalEvidence(legacyWithoutCount)).toBeNull();
    expect(
      decodeAgentRunTerminalEvidence({ ...legacy, completedBlockingGoalCount: -1 }),
    ).toBeNull();
    expect(decodeAgentRunTerminalEvidence({ ...legacy, version: 2 })).toBeNull();
  });

  it('collects the settled receipt of each turn tool call, then the terminal proof', () => {
    const turnMessages = [
      TURN_USER,
      assistantWithToolCalls('assistant-1', [
        toolCall('call-1', 'calendar_list', [
          receipt('call-1', 'calendar_list', {
            effectKind: 'observation.read',
            effectState: 'none',
            verificationState: 'not_applicable',
          }),
        ]),
        toolCall('call-2', 'update_plan', [receipt('call-2', 'update_plan')]),
        toolCall('call-3', 'web_search'),
      ]),
      assistantWithToolCalls('assistant-2', [
        toolCall('call-4', 'calendar_create_event', [
          receipt('call-4', 'calendar_create_event', {
            effectState: 'pending',
            verificationState: 'unverified',
            recordedAt: 11,
          }),
          receipt('call-4', 'calendar_create_event', {
            receiptId: `ter_${'4'.repeat(32)}`,
            recordedAt: 12,
          }),
        ]),
      ]),
      { id: 'assistant-3', role: 'assistant', content: 'Booked.', timestamp: 3 } as Message,
    ];

    const evidence = collectAgentRunMemoryEvidence(completedRun(), turnMessages);

    expect(evidence).toHaveLength(3);
    expect(evidence.slice(0, 2).map((entry) => parseToolEffectReceiptEvidence(entry))).toEqual([
      expect.objectContaining({ toolCallId: 'call-1', effectState: 'none' }),
      expect.objectContaining({
        toolCallId: 'call-4',
        receiptId: `ter_${'4'.repeat(32)}`,
        effectState: 'applied',
      }),
    ]);
    expect(parseAgentRunTerminalEvidence(evidence[2]!)).toEqual(
      expect.objectContaining({ version: 2, sourceRunId: 'run-1' }),
    );
  });

  it('carries receipts without a terminal proof, and nothing without a run', () => {
    const turnMessages = [
      TURN_USER,
      assistantWithToolCalls('assistant-1', [
        toolCall('call-1', 'calendar_create_event', [receipt('call-1', 'calendar_create_event')]),
      ]),
    ];

    const evidence = collectAgentRunMemoryEvidence(
      completedRun({ status: 'cancelled' }),
      turnMessages,
    );

    expect(evidence).toHaveLength(1);
    expect(parseToolEffectReceiptEvidence(evidence[0]!)).toEqual(
      expect.objectContaining({ toolCallId: 'call-1' }),
    );
    expect(collectAgentRunMemoryEvidence(undefined, turnMessages)).toEqual([]);
  });

  it('rejects extra fields and malformed exact identities', () => {
    const encoded = buildAgentRunTerminalEvidence(completedRun())!;
    const parsed = JSON.parse(encoded.slice(AGENT_RUN_TERMINAL_EVIDENCE_PREFIX.length));

    expect(
      parseAgentRunTerminalEvidence(
        `${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}${JSON.stringify({ ...parsed, extra: true })}`,
      ),
    ).toBeNull();
    expect(
      parseAgentRunTerminalEvidence(
        `${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}${JSON.stringify({
          ...parsed,
          sourceRunId: ' run-1',
        })}`,
      ),
    ).toBeNull();
  });
});
