jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { buildToolEffectReceiptEvidence } from '../../../src/engine/goals/effectCompletionEvidence';
import { recordAgentRunEvidenceMemory } from '../../../src/services/memory/agentRunEvidenceMemory';
import {
  AGENT_RUN_TERMINAL_EVIDENCE_PREFIX,
  type AgentRunTerminalEvidence,
} from '../../../src/services/memory/agentRunTerminalEvidence';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const DIGEST = `sha256:${'1'.repeat(64)}` as const;

function receipt(index: number, recordedAt: number): ToolEffectReceipt {
  const toolName = index === 1 ? 'calendar_list' : 'calendar_create_event';
  return {
    version: 2,
    receiptId: `ter_${String(index).repeat(32)}`,
    toolCallId: `call-${index}`,
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
    executionRunId: 'run-receipts',
    transportState: 'returned',
    effectKind: index === 1 ? 'observation.read' : 'calendar.create',
    effectState: index === 1 ? 'none' : 'applied',
    verificationState: index === 1 ? 'not_applicable' : 'verified',
    requestDigest: DIGEST,
    resultDigest: DIGEST,
    resource: { kind: 'calendar', id: `calendar-${index}` },
    recordedAt,
  };
}

function terminal(sourceRunId = 'run-receipts'): string {
  const evidence: AgentRunTerminalEvidence = {
    version: 1,
    sourceRunId,
    goal: 'Create a calendar event',
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform: 'ios',
    completedBlockingGoalCount: 1,
  };
  return `${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}${JSON.stringify(evidence)}`;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('agent-run effect receipt memory', () => {
  it('preserves terminal proof and orders exact effect receipts by observation time', () => {
    recordAgentRunEvidenceMemory({
      evidence: [
        buildToolEffectReceiptEvidence(receipt(2, 20)),
        buildToolEffectReceiptEvidence(receipt(1, 10)),
        terminal(),
      ],
      conversationId: 'conversation-1',
      threadId: 'thread-1',
      taskId: 'task-1',
      sourceRunId: 'run-receipts',
      sourceTurnId: 'assistant-1',
      now: 30,
    });

    const fact = listFacts({ memoryKind: 'agent_run' })[0]!;
    expect(fact.attributes.terminalEvidence).toEqual(
      expect.objectContaining({
        sourceRunId: 'run-receipts',
        runStatus: 'completed',
        graphStatus: 'finalized',
      }),
    );
    expect(fact.attributes.effectReceipts).toEqual([
      expect.objectContaining({
        receiptId: `ter_${'1'.repeat(32)}`,
        toolName: 'calendar_list',
        recordedAt: 10,
      }),
      expect.objectContaining({
        receiptId: `ter_${'2'.repeat(32)}`,
        toolName: 'calendar_create_event',
        recordedAt: 20,
      }),
    ]);
    expect(JSON.parse(fact.objectText)).toEqual(
      expect.objectContaining({
        goal: 'Create a calendar event',
        status: 'completed',
        outcome: 'finalized',
        domain: 'mobile-assistant',
        environment: 'kavi-ios',
      }),
    );
  });

  it('fails closed when code-owned receipt or terminal proof belongs to another run', () => {
    expect(() =>
      recordAgentRunEvidenceMemory({
        evidence: [buildToolEffectReceiptEvidence(receipt(1, 10))],
        conversationId: 'conversation-1',
        threadId: 'thread-1',
        taskId: 'task-1',
        sourceRunId: 'another-run',
        sourceTurnId: 'assistant-1',
        now: 30,
      }),
    ).toThrow('memory_agent_run_receipt_run_mismatch');
    expect(() =>
      recordAgentRunEvidenceMemory({
        evidence: [terminal()],
        conversationId: 'conversation-1',
        threadId: 'thread-1',
        taskId: 'task-1',
        sourceRunId: 'another-run',
        sourceTurnId: 'assistant-1',
        now: 30,
      }),
    ).toThrow('memory_agent_run_terminal_run_mismatch');
  });
});
