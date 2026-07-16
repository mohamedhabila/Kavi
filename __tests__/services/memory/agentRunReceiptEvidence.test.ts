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
import { getFactById, listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import type {
  CodeOwnedToolContractIdentity,
  ToolEffectReceipt,
} from '../../../src/types/toolEffectReceipt';
import { RECEIPT_BACKED_PROCEDURE_PREDICATE } from '../../../src/services/memory/receiptBackedProcedurePromotion';
import {
  resolveApplicableReceiptBackedProcedure,
  type ReceiptBackedProcedureRuntime,
} from '../../../src/services/memory/receiptBackedProcedureRecall';
import {
  buildReceiptBackedProcedureLearningArtifact,
  digestReceiptBackedToolContractIdentity,
  projectReceiptBackedProcedureObservation,
} from '../../../src/services/memory/receiptBackedProcedureLearning';

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

function receipt(index: number, recordedAt: number, runId = 'run-receipts'): ToolEffectReceipt {
  const toolName = index === 1 ? 'calendar_list' : 'calendar_create_event';
  return {
    version: 2,
    receiptId: `ter_${String(index).repeat(32)}`,
    toolCallId: `call-${index}`,
    toolName,
    contractIdentity: contract(toolName),
    executionRunId: runId,
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

function terminal(
  sourceRunId = 'run-receipts',
  goal = 'Create a calendar event',
): string {
  const evidence: AgentRunTerminalEvidence = {
    version: 1,
    sourceRunId,
    goal,
    runStatus: 'completed',
    graphStatus: 'finalized',
    platform: 'ios',
    completedBlockingGoalCount: 1,
    observedToolCallIds: ['call-1', 'call-2'],
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

  it('materializes and live-validates one global procedure after three independent runs', async () => {
    const recordRun = (runId: string, index: number, goal: string) =>
      recordAgentRunEvidenceMemory({
        evidence: [
          buildToolEffectReceiptEvidence({
            ...receipt(1, index * 10 + 1, runId),
            receiptId: `ter_${index.toString(16).repeat(32)}`,
            toolCallId: 'call-1',
          }),
          buildToolEffectReceiptEvidence({
            ...receipt(2, index * 10 + 2, runId),
            receiptId: `ter_${(index + 8).toString(16).repeat(32)}`,
            toolCallId: 'call-2',
          }),
          terminal(runId, goal),
        ],
        conversationId: `conversation-${index}`,
        threadId: `thread-${index}`,
        taskId: `task-${index}`,
        sourceRunId: runId,
        sourceTurnId: `assistant-${index}`,
        now: index * 100,
      });

    recordRun('run-learning-1', 1, 'Create a calendar design review');
    recordRun('run-learning-2', 2, 'Schedule the calendar design review');
    expect(listFacts({ predicate: RECEIPT_BACKED_PROCEDURE_PREDICATE })).toEqual([]);

    const third = recordRun('run-learning-3', 3, 'Add the design review to my calendar');
    expect(
      third.factIds
        .map(getFactById)
        .filter((fact): fact is NonNullable<typeof fact> => fact !== null)
        .map(projectReceiptBackedProcedureObservation)
        .filter(Boolean),
    ).toHaveLength(1);
    const sourceRuns = listFacts({ memoryKind: 'agent_run' }).filter(
      (fact) => fact.predicate === 'agent_run',
    );
    expect(sourceRuns.map((fact) => fact.memoryOwnerId)).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    expect(buildReceiptBackedProcedureLearningArtifact(sourceRuns).diagnostics).toEqual(
      expect.objectContaining({
        validObservationCount: 3,
        learnedProcedureCount: 1,
      }),
    );
    const learned = listFacts({ predicate: RECEIPT_BACKED_PROCEDURE_PREDICATE });

    expect(learned).toHaveLength(1);
    expect(third.factIds).toContain(learned[0]!.id);
    expect(learned[0]).toEqual(
      expect.objectContaining({
        scope: 'global',
        originConversationId: null,
        originThreadId: null,
        originTaskId: null,
        sourceAuthority: 'tool_observed',
        reviewState: 'verified',
      }),
    );
    expect(learned[0]!.attributes).toEqual(
      expect.objectContaining({
        experienceLearningVersion: 1,
        supportRunCount: 3,
        supportRunIds: ['run-learning-1', 'run-learning-2', 'run-learning-3'],
        contract: expect.objectContaining({
          replayPolicy: expect.objectContaining({ mode: 'advisory_only' }),
        }),
      }),
    );

    const runtime: ReceiptBackedProcedureRuntime = {
      platform: 'ios',
      buildContractIdentity: async (toolName) => contract(toolName),
      isToolAllowed: () => true,
      isToolAvailable: () => true,
    };
    const persistedSteps = (learned[0]!.attributes.contract as {
      orderedSteps: Array<{ toolName: string; contractIdentityDigest: string }>;
    }).orderedSteps;
    expect(
      persistedSteps.map((step) => step.contractIdentityDigest),
    ).toEqual(
      persistedSteps.map((step) => digestReceiptBackedToolContractIdentity(contract(step.toolName))),
    );
    let rejection: string | undefined;
    const applicable = await resolveApplicableReceiptBackedProcedure({
      fact: learned[0]!,
      memoryOwnerId: learned[0]!.memoryOwnerId!,
      asOf: 300,
      runtime,
      onReject: (reason) => {
        rejection = reason;
      },
    });
    expect(rejection).toBeUndefined();
    expect(applicable?.section).toContain('3 independent finalized runs');
    expect(applicable?.section).toContain('calendar_list');
    expect(applicable?.section).toContain('normal approval requirements');

    expect(
      await resolveApplicableReceiptBackedProcedure({
        fact: learned[0]!,
        memoryOwnerId: learned[0]!.memoryOwnerId!,
        asOf: 300,
        runtime: { ...runtime, platform: 'android' },
      }),
    ).toBeNull();
    expect(
      await resolveApplicableReceiptBackedProcedure({
        fact: learned[0]!,
        memoryOwnerId: learned[0]!.memoryOwnerId!,
        asOf: 300,
        runtime: { ...runtime, isToolAllowed: () => false },
      }),
    ).toBeNull();
    expect(
      await resolveApplicableReceiptBackedProcedure({
        fact: learned[0]!,
        memoryOwnerId: learned[0]!.memoryOwnerId!,
        asOf: 300,
        runtime: {
          ...runtime,
          buildContractIdentity: async (toolName) => ({
            ...contract(toolName),
            schemaDigest: `sha256:${'9'.repeat(64)}`,
          }),
        },
      }),
    ).toBeNull();
    expect(
      await resolveApplicableReceiptBackedProcedure({
        fact: {
          ...learned[0]!,
          attributes: {
            ...learned[0]!.attributes,
            supportFactIds: [
              ...(learned[0]!.attributes.supportFactIds as string[]).slice(0, 2),
              'fact-missing',
            ],
          },
        },
        memoryOwnerId: learned[0]!.memoryOwnerId!,
        asOf: 300,
        runtime,
      }),
    ).toBeNull();
  });
});
