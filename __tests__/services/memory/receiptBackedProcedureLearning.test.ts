import {
  buildReceiptBackedProcedureLearningArtifact,
  projectReceiptBackedProcedureObservation,
  renderReceiptBackedProcedureLearning,
  selectReceiptBackedProcedureLearnings,
} from '../../../src/services/memory/receiptBackedProcedureLearning';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import type { CodeOwnedToolContractIdentity } from '../../../src/types/toolEffectReceipt';
import { sha256HexUtf8 } from '../../../src/utils/sha256';

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

function receipt(params: {
  runId: string;
  index: number;
  toolName: string;
  effectKind: 'observation.read' | 'calendar.create';
  effectState: 'none' | 'applied';
  verificationState: 'not_applicable' | 'verified';
}) {
  return {
    receiptId: `ter_${sha256HexUtf8(`${params.runId}:${params.index}`).slice(0, 32)}`,
    toolCallId: `call-${params.runId}-${params.index}`,
    toolName: params.toolName,
    contractIdentity: contract(params.toolName),
    executionRunId: params.runId,
    transportState: 'returned',
    effectKind: params.effectKind,
    effectState: params.effectState,
    verificationState: params.verificationState,
    requestDigest: DIGEST,
    resultDigest: DIGEST,
    resource: { kind: 'calendar', id: `${params.runId}-${params.index}` },
    recordedAt: params.index,
  };
}

function rawRunFact(
  runId: string,
  goal: string,
  overrides: Partial<MemoryFact> = {},
): MemoryFact {
  const firstCall = `call-${runId}-1`;
  const secondCall = `call-${runId}-2`;
  return {
    id: `fact-${runId}`,
    subjectId: 'subject-1',
    predicate: 'agent_run',
    objectText: JSON.stringify({ sourceRunId: runId, goal, status: 'completed' }),
    objectEntityId: null,
    attributes: {
      terminalEvidence: {
        version: 1,
        sourceRunId: runId,
        goal,
        runStatus: 'completed',
        graphStatus: 'finalized',
        platform: 'ios',
        completedBlockingGoalCount: 1,
        observedToolCallIds: [firstCall, secondCall],
      },
      effectReceipts: [
        receipt({
          runId,
          index: 1,
          toolName: 'calendar_list',
          effectKind: 'observation.read',
          effectState: 'none',
          verificationState: 'not_applicable',
        }),
        receipt({
          runId,
          index: 2,
          toolName: 'calendar_create_event',
          effectKind: 'calendar.create',
          effectState: 'applied',
          verificationState: 'verified',
        }),
      ],
    },
    confidence: 0.82,
    sourceMessageId: 'message-1',
    sourceRunId: runId,
    memoryOwnerId: 'owner-1',
    personaId: null,
    factClass: 'workflow',
    sourceAuthority: 'assistant_inferred',
    scope: 'session',
    originConversationId: 'conversation-1',
    originThreadId: 'thread-1',
    originTaskId: 'task-1',
    sourceTurnId: 'turn-1',
    sourceSummary: null,
    importance: 0.8,
    accessCount: 0,
    repeatedMentionCount: 0,
    lastRecalledAt: null,
    lastReinforcedAt: null,
    lastAccessedAt: null,
    decayPolicy: 'normal',
    expiresAt: null,
    contentHash: `hash-${runId}`,
    localSimilarity: null,
    validAt: 10,
    invalidAt: null,
    createdAt: 10,
    updatedAt: 10,
    deletedAt: null,
    pinned: false,
    sourceActorId: null,
    retrievability: 0.8,
    stability: 0.7,
    decayRate: 0.03,
    lastPresentedAt: null,
    lastConfirmedAt: null,
    lastConflictedAt: null,
    reviewState: 'auto',
    sensitivity: 'normal',
    memoryKind: 'agent_run',
    ...overrides,
  };
}

describe('receipt-backed procedure learning', () => {
  it('projects exact ordered contracts from finalized receipt-backed runs', () => {
    const observation = projectReceiptBackedProcedureObservation(
      rawRunFact('run-1', 'Create a calendar event'),
    );

    expect(observation).toEqual(
      expect.objectContaining({
        runId: 'run-1',
        domainId: 'calendar',
        environmentId: 'kavi-ios',
        receiptIds: [
          `ter_${sha256HexUtf8('run-1:1').slice(0, 32)}`,
          `ter_${sha256HexUtf8('run-1:2').slice(0, 32)}`,
        ],
        contract: expect.objectContaining({
          platform: 'ios',
          replayPolicy: {
            mode: 'advisory_only',
            argumentPolicy: 'derive_from_current_request',
            approvalPolicy: 'normal_product_policy',
            effectPolicy: 'verify_current_effects',
          },
          orderedSteps: [
            expect.objectContaining({
              sequence: 0,
              toolName: 'calendar_list',
              settlement: 'observed',
            }),
            expect.objectContaining({
              sequence: 1,
              toolName: 'calendar_create_event',
              settlement: 'verified_effect',
            }),
          ],
        }),
      }),
    );
  });

  it('promotes only after three distinct directly verified runs', () => {
    const two = buildReceiptBackedProcedureLearningArtifact([
      rawRunFact('run-1', 'Create a calendar design review'),
      rawRunFact('run-2', 'Schedule the calendar design review'),
    ]);
    const three = buildReceiptBackedProcedureLearningArtifact([
      rawRunFact('run-1', 'Create a calendar design review'),
      rawRunFact('run-2', 'Schedule the calendar design review'),
      rawRunFact('run-3', 'Add the design review to my calendar'),
    ]);

    expect(two.artifact.records).toEqual([]);
    expect(two.diagnostics.insufficientProcedureCount).toBe(1);
    expect(three.artifact.records).toHaveLength(1);
    expect(three.artifact.records[0]).toEqual(
      expect.objectContaining({
        recommendation: 'prefer',
        confidence: 0.6,
        evidence: expect.objectContaining({
          runIds: ['run-1', 'run-2', 'run-3'],
          factIds: ['fact-run-1', 'fact-run-2', 'fact-run-3'],
        }),
      }),
    );
  });

  it('retrieves by Unicode task semantics and renders binding replay guardrails', () => {
    const artifact = buildReceiptBackedProcedureLearningArtifact([
      rawRunFact('run-1', 'أنشئ موعد مراجعة التصميم في التقويم'),
      rawRunFact('run-2', 'أضف مراجعة التصميم إلى التقويم'),
      rawRunFact('run-3', 'جدول مراجعة التصميم في التقويم'),
    ]).artifact;

    const selected = selectReceiptBackedProcedureLearnings({
      artifact,
      query: 'موعد جديد لمراجعة التصميم',
    });
    const rendered = renderReceiptBackedProcedureLearning(selected[0]!);

    expect(selected).toHaveLength(1);
    expect(rendered).toContain('calendar_list');
    expect(rendered).toContain('calendar_create_event');
    expect(rendered).toContain('derive arguments from the current request');
    expect(rendered).toContain('never reuse prior request digests');
    expect(rendered).toContain('normal approval requirements');
    expect(rendered).toContain('Verify every current effect');
  });

  it('rejects incomplete, unverified, runtime-external, or misordered evidence', () => {
    const base = rawRunFact('run-1', 'Create a calendar event');
    const receipts = base.attributes.effectReceipts as Array<Record<string, unknown>>;
    const unverified = rawRunFact('run-2', 'Create a calendar event', {
      attributes: {
        ...base.attributes,
        terminalEvidence: {
          ...(base.attributes.terminalEvidence as object),
          sourceRunId: 'run-2',
          observedToolCallIds: ['call-run-2-1', 'call-run-2-2'],
        },
        effectReceipts: [
          receipt({
            runId: 'run-2',
            index: 1,
            toolName: 'calendar_list',
            effectKind: 'observation.read',
            effectState: 'none',
            verificationState: 'not_applicable',
          }),
          {
            ...receipt({
              runId: 'run-2',
              index: 2,
              toolName: 'calendar_create_event',
              effectKind: 'calendar.create',
              effectState: 'applied',
              verificationState: 'verified',
            }),
            verificationState: 'acknowledged',
          },
        ],
      },
      sourceRunId: 'run-2',
    });
    const external = rawRunFact('run-3', 'Create a calendar event', {
      attributes: {
        ...rawRunFact('run-3', 'Create a calendar event').attributes,
        effectReceipts: [
          {
            ...(rawRunFact('run-3', 'Create a calendar event').attributes
              .effectReceipts as Array<Record<string, unknown>>)[0],
            contractIdentity: {
              kind: 'runtime_external',
              version: 1,
              toolName: 'calendar_list',
              source: 'mcp',
              namespace: 'calendar',
              declarationDigest: DIGEST,
              executionBindingDigest: DIGEST,
            },
          },
          (rawRunFact('run-3', 'Create a calendar event').attributes
            .effectReceipts as Array<Record<string, unknown>>)[1],
        ],
      },
    });
    const misordered = rawRunFact('run-4', 'Create a calendar event', {
      attributes: {
        ...rawRunFact('run-4', 'Create a calendar event').attributes,
        terminalEvidence: {
          ...(rawRunFact('run-4', 'Create a calendar event').attributes
            .terminalEvidence as object),
          observedToolCallIds: ['call-run-4-2', 'call-run-4-1'],
        },
      },
    });

    expect(receipts).toHaveLength(2);
    expect(projectReceiptBackedProcedureObservation(unverified)).toBeNull();
    expect(projectReceiptBackedProcedureObservation(external)).toBeNull();
    expect(projectReceiptBackedProcedureObservation(misordered)).toBeNull();
  });

  it('never treats a derived learning fact as a new independent run', () => {
    expect(
      projectReceiptBackedProcedureObservation(
        rawRunFact('run-1', 'Create a calendar event', {
          attributes: { experienceLearningVersion: 1 },
        }),
      ),
    ).toBeNull();
  });
});
