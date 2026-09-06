jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { recordAgentRunEvidenceMemory } from '../../../src/services/memory/agentRunEvidenceMemory';
import { listFacts } from '../../../src/services/memory/facts/queries';
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

describe('recordAgentRunEvidenceMemory — ingestion, filtering, and authority', () => {
  it('does not consume non-json graph evidence that belongs to durable fact bridging', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: ['python:artifact:reports/analysis.json'],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-non-json',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(0);
    expect(result.factIds).toHaveLength(0);
    expect(listFacts({ originConversationId: 'conv-agent-memory' })).toHaveLength(0);
  });

  it('does not persist internal control-plane tool results as experience evidence', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: [
        `agent:${JSON.stringify({
          trajectory_id: 'run-internal-memory',
          state_index: 1,
          toolName: 'memory_remember',
          toolResult: '{"value":"superseded-contact"}',
          status: 'completed',
        })}`,
        `agent:${JSON.stringify({
          trajectory_id: 'run-external-observation',
          state_index: 1,
          toolName: 'contacts_search',
          toolResult: '{"name":"current-contact"}',
          status: 'completed',
        })}`,
      ],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-control-plane',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    expect(result.factIds).toHaveLength(facts.length);
    expect(facts.map((fact) => fact.objectText).join('\n')).not.toContain('superseded-contact');
    expect(facts.map((fact) => fact.objectText).join('\n')).toContain('current-contact');
  });

  it('does not persist structurally restricted agent-run content', () => {
    const syntheticStructuredSecret = `gh${'p_'}${'abcdefghijklmnopqrstuvwxyz'}${'ABCDEFGHIJ'}`;
    const result = recordAgentRunEvidenceMemory({
      evidence: [
        `agent:${JSON.stringify({
          trajectory_id: 'run-restricted',
          goal: syntheticStructuredSecret,
          state_index: 1,
          action: 'opaque-action',
        })}`,
      ],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-restricted',
      now: 10,
    });

    expect(result.factIds).toEqual([]);
    expect(listFacts({ originConversationId: 'conv-agent-memory' })).toEqual([]);
  });

  it('stores unsuccessful agent-run evidence with lower answer authority', () => {
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-success',
        goal: 'Inspect the target record',
        outcome: 'success',
        state_index: 1,
        action: 'Inspect',
        toolName: 'browser_state',
      })}`,
      `agent:${JSON.stringify({
        trajectory_id: 'run-failure',
        goal: 'Inspect the target record',
        outcome: 'failure',
        state_index: 1,
        action: 'Inspect',
        toolName: 'browser_state',
      })}`,
    ];

    const result = recordAgentRunEvidenceMemory({
      evidence,
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-authority',
      now: 10,
    });

    expect(result.factIds.length).toBeGreaterThanOrEqual(2);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const success = facts.find(
      (fact) => fact.sourceRunId === 'run-success' && fact.memoryKind === 'agent_run',
    );
    const failure = facts.find(
      (fact) => fact.sourceRunId === 'run-failure' && fact.memoryKind === 'agent_run',
    );
    expect(success).toBeDefined();
    expect(failure).toBeDefined();
    expect(failure?.confidence).toBeLessThan(success?.confidence ?? 0);
    expect(failure?.retrievability).toBeLessThan(success?.retrievability ?? 0);
  });

  it('keeps observed source evidence retrievable even when the run outcome failed', () => {
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-failed-observed',
        goal: 'Inspect current controls',
        outcome: 'failure',
        state_index: 1,
        action: 'Inspect',
        accessibility_tree: "[menu-1] menuitem 'Incident Mobile', visible",
        toolName: 'browser_state',
      })}`,
    ];

    const result = recordAgentRunEvidenceMemory({
      evidence,
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-failed-observed',
      now: 10,
    });

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    expect(facts.some((fact) => fact.memoryKind === 'evidence_span')).toBe(true);
    expect(agentRun?.confidence).toBeGreaterThan(0.8);
    expect(agentRun?.retrievability).toBeGreaterThan(0.8);
  });

  it('merges richer tool-result state evidence over earlier tool-call shells', () => {
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-merge',
        state_index: 11,
        toolName: 'browser_state',
        status: 'completed',
      })}`,
      `agent:${JSON.stringify({
        trajectory_id: 'run-merge',
        state_index: 11,
        action: 'Open menu',
        accessibility_tree: [
          "RootWebArea 'Records'",
          "[menu-1] menuitem 'Incident Mobile', visible",
          "[menu-2] menuitem 'Incident Portal', visible",
          "[menu-3] menuitem 'My Open Incidents', visible",
        ].join('\n'),
        toolName: 'browser_state',
        status: 'completed',
      })}`,
    ];

    const result = recordAgentRunEvidenceMemory({
      evidence,
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-1',
      now: 10,
    });

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    const rendered = JSON.stringify(agentRunRecord);
    expect(rendered).toContain('Open menu');
    expect(rendered).toContain('Incident Mobile');
    expect(rendered).toContain('Incident Portal');
    expect(rendered).toContain('My Open Incidents');
  });

  it('does not create empty run records from unrelated json payloads', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: [`agent:${JSON.stringify({ trajectory_id: 'run-empty', value: 42 })}`],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceRunId: 'fallback-run',
      sourceTurnId: 'assistant-empty',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(0);
    expect(result.factIds).toHaveLength(0);
    expect(listFacts({ originConversationId: 'conv-agent-memory' })).toHaveLength(0);
  });
});
