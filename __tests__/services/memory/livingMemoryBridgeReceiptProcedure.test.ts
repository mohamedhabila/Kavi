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
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import type { ReceiptBackedProcedureRuntime } from '../../../src/services/memory/receiptBackedProcedureRecall';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import type {
  CodeOwnedToolContractIdentity,
  ToolEffectReceipt,
} from '../../../src/types/toolEffectReceipt';
import type { Message } from '../../../src/types/message';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const DIGEST = `sha256:${'1'.repeat(64)}` as const;

function contract(toolName: string): CodeOwnedToolContractIdentity {
  return {
    kind: 'code_owned',
    version: 1,
    toolName,
    schemaDigest: DIGEST,
    capabilityContractDigest: DIGEST,
    workflowContractDigest: DIGEST,
    effectContractDigest: DIGEST,
    executionPolicyDigest: DIGEST,
  };
}

function receipt(runId: string, index: number): ToolEffectReceipt {
  const toolName = index === 1 ? 'calendar_list' : 'calendar_create_event';
  return {
    version: 2,
    receiptId: `ter_${sha256HexUtf8(`${runId}:${index}`).slice(0, 32)}`,
    toolCallId: `call-${runId}-${index}`,
    toolName,
    contractIdentity: contract(toolName),
    executionRunId: runId,
    transportState: 'returned',
    effectKind: index === 1 ? 'observation.read' : 'calendar.create',
    effectState: index === 1 ? 'none' : 'applied',
    verificationState: index === 1 ? 'not_applicable' : 'verified',
    requestDigest: DIGEST,
    resultDigest: DIGEST,
    resource: { kind: 'calendar', id: `${runId}-${index}` },
    recordedAt: index,
  };
}

function terminal(runId: string, goal: string): string {
  const evidence: AgentRunTerminalEvidence = {
    version: 1,
    sourceRunId: runId,
    goal,
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform: 'ios',
    completedBlockingGoalCount: 1,
    observedToolCallIds: [`call-${runId}-1`, `call-${runId}-2`],
  };
  return `${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}${JSON.stringify(evidence)}`;
}

function recordRun(runId: string, index: number, goal: string): void {
  recordAgentRunEvidenceMemory({
    evidence: [
      buildToolEffectReceiptEvidence(receipt(runId, 1)),
      buildToolEffectReceiptEvidence(receipt(runId, 2)),
      terminal(runId, goal),
    ],
    conversationId: `source-conversation-${index}`,
    threadId: `source-thread-${index}`,
    taskId: `source-task-${index}`,
    sourceRunId: runId,
    sourceTurnId: `assistant-${index}`,
    now: index * 100,
  });
}

function userMessage(content: string): Message {
  return { id: 'user-current', role: 'user', content, timestamp: 1_000 } as Message;
}

const runtime: ReceiptBackedProcedureRuntime = {
  platform: 'ios',
  buildContractIdentity: async (toolName) => contract(toolName),
  isToolAllowed: () => true,
  isToolAvailable: () => true,
};

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  recordRun('run-learning-1', 1, 'Create a calendar design review');
  recordRun('run-learning-2', 2, 'Schedule the calendar design review');
  recordRun('run-learning-3', 3, 'Add the design review to my calendar');
});

afterEach(() => {
  closeMemoryDb();
});

describe('living-memory receipt-backed procedure recall', () => {
  it('injects only the live-revalidated advisory on a matching held-out task', async () => {
    const output = await buildLivingMemorySections({
      messages: [userMessage('Schedule another calendar design review')],
      conversationId: 'held-out-conversation',
      sourceThreadId: 'held-out-thread',
      personaId: 'default',
      taskId: null,
      now: 1_100,
      receiptBackedProcedureRuntime: runtime,
    });
    const prompt = output.sections.map((section) => section.text).join('\n');

    expect(output.recalledFactCount).toBe(1);
    expect(prompt).toContain('### Receipt-backed procedure experience');
    expect(prompt).toContain('calendar_list');
    expect(prompt).toContain('calendar_create_event');
    expect(prompt).toContain('derive arguments from the current request');
    expect(prompt).not.toContain('receipt_backed_procedure:');
  });

  it('supports a same-path learning-off ablation without disabling other memory', async () => {
    const output = await buildLivingMemorySections({
      messages: [userMessage('Schedule another calendar design review')],
      conversationId: 'held-out-conversation',
      sourceThreadId: 'held-out-thread',
      personaId: 'default',
      taskId: null,
      now: 1_100,
      receiptBackedProcedureRuntime: runtime,
      disableExperienceLearningRecall: true,
    });
    const prompt = output.sections.map((section) => section.text).join('\n');

    expect(output.recalledFactCount).toBe(0);
    expect(prompt).not.toContain('Receipt-backed procedure experience');
  });

  it('suppresses learned guidance when current runtime context drifts', async () => {
    const output = await buildLivingMemorySections({
      messages: [userMessage('Schedule another calendar design review')],
      conversationId: 'held-out-conversation',
      sourceThreadId: 'held-out-thread',
      personaId: 'default',
      taskId: null,
      now: 1_100,
      receiptBackedProcedureRuntime: { ...runtime, isToolAllowed: () => false },
    });
    const prompt = output.sections.map((section) => section.text).join('\n');

    expect(output.recalledFactCount).toBe(0);
    expect(prompt).not.toContain('Receipt-backed procedure experience');
  });
});
