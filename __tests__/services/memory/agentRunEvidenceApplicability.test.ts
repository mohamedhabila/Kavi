jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { recordAgentRunEvidenceMemory } from '../../../src/services/memory/agentRunEvidenceMemory';
import {
  listFacts,
  listFactsForRecallEligibleScan,
} from '../../../src/services/memory/facts/queries';
import { applyMemoryApplicabilityPolicy } from '../../../src/services/memory/memoryApplicabilityPolicy';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('agent-run evidence applicability', () => {
  it('preserves an observation-only record as direct evidence instead of aliasing it to outcome', () => {
    recordAgentRunEvidenceMemory({
      evidence: [
        `agent:${JSON.stringify({
          trajectory_id: 'run-observation-only',
          state_index: 1,
          observation: 'The release manifest exists.',
          status: 'completed',
        })}`,
      ],
      conversationId: 'conv-observation-only',
      threadId: 'conv-observation-only',
      taskId: null,
      sourceTurnId: 'assistant-observation-only',
      now: 10,
    });

    const facts = listFacts({ originConversationId: 'conv-observation-only' });
    const span = facts.find((fact) => fact.memoryKind === 'evidence_span');
    expect(span?.sourceAuthority).toBe('tool_observed');
    expect(JSON.parse(span?.objectText ?? '{}')).toMatchObject({
      sourceRunId: 'run-observation-only',
      observation: 'The release manifest exists.',
      status: 'completed',
    });
    expect(JSON.parse(span?.objectText ?? '{}')).not.toHaveProperty('outcome');
  });

  it('admits only directly observed evidence spans to automatic recall', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: [
        `agent:${JSON.stringify({
          trajectory_id: 'run-observed-applicability',
          goal: 'Analyze the dataset',
          state_index: 1,
          action: 'Run analysis',
          thought: 'Need a durable report artifact.',
          toolName: 'python',
        })}`,
        `agent:${JSON.stringify({
          trajectory_id: 'run-observed-applicability',
          state_index: 2,
          outcome: 'reports/analysis.json was created',
          artifact: 'reports/analysis.json',
          toolName: 'python',
          toolResult: 'reports/analysis.json was created',
        })}`,
      ],
      conversationId: 'conv-observed-applicability',
      threadId: 'conv-observed-applicability',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-1',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(2);
    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-observed-applicability' });
    const aggregate = facts.find((fact) => fact.memoryKind === 'agent_run');
    const spans = facts.filter((fact) => fact.memoryKind === 'evidence_span');
    expect(aggregate?.sourceAuthority).toBe('assistant_inferred');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.sourceAuthority).toBe('tool_observed');
    const spanRecord = JSON.parse(spans[0]?.objectText ?? '{}');
    expect(spanRecord).toMatchObject({
      sourceRunId: 'run-observed-applicability',
      toolName: 'python',
      toolResult: 'reports/analysis.json was created',
    });
    expect(spanRecord).not.toHaveProperty('goal');
    expect(spanRecord).not.toHaveProperty('thought');
    expect(spanRecord).not.toHaveProperty('action');
    expect(spanRecord).not.toHaveProperty('outcome');

    const memoryScope = resolveLocalMemoryAccessScope({
      memoryConversationId: 'conv-observed-applicability',
      sourceThreadId: 'conv-observed-applicability',
      personaId: 'default',
      taskId: 'task-analysis',
    });
    const direct = listFactsForRecallEligibleScan({
      recallScopeIdentity: {
        ...memoryScope,
        useIntent: 'automatic_prompt',
        candidateLane: 'direct_use',
      },
      originConversationId: 'conv-observed-applicability',
      asOf: 20,
      limit: 10,
    });
    expect(direct.map((fact) => fact.id)).toEqual(spans.map((fact) => fact.id));
  });

  it('keeps multiple directly observed spans from independent runs usable together', () => {
    for (const [sourceRunId, observation] of [
      ['run-observed-first', 'The first control is present.'],
      ['run-observed-second', 'The second control is present.'],
    ] as const) {
      recordAgentRunEvidenceMemory({
        evidence: [
          `agent:${JSON.stringify({
            trajectory_id: sourceRunId,
            state_index: 1,
            toolName: 'mobile_observer',
            toolResult: observation,
            status: 'completed',
          })}`,
        ],
        conversationId: 'conv-observed-additive',
        threadId: 'conv-observed-additive',
        taskId: null,
        sourceTurnId: `assistant-${sourceRunId}`,
        now: sourceRunId === 'run-observed-first' ? 10 : 20,
      });
    }

    const spans = listFacts({ originConversationId: 'conv-observed-additive' }).filter(
      (fact) => fact.memoryKind === 'evidence_span',
    );
    expect(spans).toHaveLength(2);
    const memoryScope = resolveLocalMemoryAccessScope({
      memoryConversationId: 'conv-observed-additive',
      sourceThreadId: 'conv-observed-additive',
      personaId: 'default',
      taskId: null,
    });

    expect(
      applyMemoryApplicabilityPolicy({
        facts: spans,
        context: {
          enabled: true,
          now: 30,
          useIntent: 'automatic_prompt',
          scope: memoryScope,
          conflictObservationReadState: 'available',
        },
      }).factDecisions,
    ).toEqual([
      expect.objectContaining({ action: 'use', reason: 'eligible' }),
      expect.objectContaining({ action: 'use', reason: 'eligible' }),
    ]);
  });

  it('keeps summary-only runs assistant-inferred and silent for automatic use', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: [
        `agent:${JSON.stringify({
          trajectory_id: 'run-summary-only',
          goal: 'Summarize a run without direct observations',
          summary: 'Assistant-composed summary without observed evidence.',
          status: 'completed',
        })}`,
      ],
      conversationId: 'conv-summary-only',
      threadId: 'conv-summary-only',
      taskId: null,
      sourceTurnId: 'assistant-summary-only',
      now: 10,
    });

    expect(result.factIds).toHaveLength(1);
    const persisted = listFacts({ originConversationId: 'conv-summary-only' });
    expect(persisted).toEqual([
      expect.objectContaining({
        memoryKind: 'agent_run',
        sourceAuthority: 'assistant_inferred',
        reviewState: 'auto',
      }),
    ]);
    const memoryScope = resolveLocalMemoryAccessScope({
      memoryConversationId: 'conv-summary-only',
      sourceThreadId: 'conv-summary-only',
      personaId: 'default',
      taskId: null,
    });
    const direct = listFactsForRecallEligibleScan({
      recallScopeIdentity: {
        ...memoryScope,
        useIntent: 'automatic_prompt',
        candidateLane: 'direct_use',
      },
      originConversationId: 'conv-summary-only',
      asOf: 20,
      limit: 10,
    });
    const resolution = listFactsForRecallEligibleScan({
      recallScopeIdentity: {
        ...memoryScope,
        useIntent: 'automatic_prompt',
        candidateLane: 'resolution',
      },
      originConversationId: 'conv-summary-only',
      asOf: 20,
      limit: 10,
    });
    expect(direct).toEqual([]);
    expect(resolution.map((fact) => fact.id)).toEqual([persisted[0]?.id]);
    expect(
      applyMemoryApplicabilityPolicy({
        facts: resolution,
        context: {
          enabled: true,
          now: 20,
          useIntent: 'automatic_prompt',
          scope: memoryScope,
          conflictObservationReadState: 'available',
        },
      }).factDecisions,
    ).toEqual([
      expect.objectContaining({
        action: 'silent',
        reason: 'workflow_authority_confirmation_required',
      }),
    ]);
  });
});
