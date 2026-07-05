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
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';

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

describe('agent-run evidence route coverage', () => {
  it('keeps sampled observed controls in source order', () => {
    const accessibilityTree = [
      ...Array.from(
        { length: 40 },
        (_entry, index) => `[${100 + index}] button 'c:${index}', clickable, visible`,
      ),
      "[200] columnheader 'h:name', visible",
      "[202] columnheader 'h:status', visible",
      "[204] columnheader 'h:owner', visible",
    ].join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-control-order',
        state_index: 1,
        action: 'act-control-order',
        toolName: 'browser_state',
        accessibility_tree: accessibilityTree,
        status: 'completed',
      })}`,
    ];

    recordAgentRunEvidenceMemory({
      evidence,
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-1',
      now: 10,
    });

    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const procedure = facts.find((fact) => fact.memoryKind === 'procedure');
    const outcome = facts.find((fact) => fact.memoryKind === 'outcome');
    const procedureRecord = JSON.parse(procedure?.objectText ?? '{}');
    const outcomeRecord = JSON.parse(outcome?.objectText ?? '{}');
    const procedureSequence = procedureRecord.steps?.[0]?.observedControlSequence ?? [];
    const outcomeSequence = outcomeRecord.lastSteps?.[0]?.observedControlSequence ?? [];
    const expectRepresentativeOrderedControls = (sequence: Array<Record<string, unknown>>) => {
      const labels = sequence.map((entry) => String(entry.label ?? ''));
      const controlIndexes = labels
        .map((label) => /^c:(\d+)$/.exec(label)?.[1])
        .filter((index): index is string => index !== undefined)
        .map((index) => Number(index));
      expect(controlIndexes).toEqual([...controlIndexes].sort((left, right) => left - right));
      expect(labels).toContain('c:0');
      expect(labels).toContain('c:20');
      expect(labels).toContain('c:37');
      expect(labels).toContain('h:name');
      expect(labels).toContain('h:owner');
    };

    expectRepresentativeOrderedControls(procedureSequence);
    expectRepresentativeOrderedControls(outcomeSequence);
    expect(JSON.stringify(procedureRecord)).toContain('"observedAffordances"');
    expect(JSON.stringify(procedureRecord)).toContain('"observedControlSequence"');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('retains representative controls inside dense observed states', () => {
    const observedState = [
      "RootWebArea 's:dense'",
      ...Array.from({ length: 60 }, (_entry, controlIndex) => {
        const marker =
          controlIndex === 0
            ? 'm:0'
            : controlIndex === 30
              ? 'm:30'
              : controlIndex === 59
                ? 'm:59'
                : `m:${controlIndex}`;
        return `[${controlIndex}] button '${marker}', clickable, visible`;
      }),
    ].join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-dense-state',
        state_index: 1,
        action: 'act-dense-state',
        url: 'https://example.test/workflow',
        accessibility_tree: observedState,
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

    expect(result.factIds).toHaveLength(2);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const procedure = facts.find((fact) => fact.memoryKind === 'procedure');
    const procedureText = JSON.stringify(JSON.parse(procedure?.objectText ?? '{}'));

    expect(procedureText).toContain('m:0');
    expect(procedureText).toContain('m:30');
    expect(procedureText).toContain('m:59');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('retains representative observed controls from long same-surface runs', () => {
    const evidence = Array.from({ length: 60 }, (_, index) => {
      const marker =
        index === 0
          ? 'r:0'
          : index === 30
            ? 'r:30'
            : index === 59
              ? 'r:59'
              : `r:${index}`;
      const observedState = [
        `RootWebArea 's:${index}'`,
        ...Array.from(
          { length: 18 },
          (_entry, controlIndex) =>
            `[${index}-${controlIndex}] button '${marker}:${controlIndex}', clickable, visible`,
        ),
      ].join('\n');
      return `agent:${JSON.stringify({
        trajectory_id: 'run-dense-same-surface',
        state_index: index,
        action: `act-route-${index}`,
        url: 'https://example.test/workflow',
        accessibility_tree: observedState,
        toolName: 'browser_state',
        status: 'completed',
      })}`;
    });

    const result = recordAgentRunEvidenceMemory({
      evidence,
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-1',
      now: 10,
    });

    expect(result.factIds).toHaveLength(2);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const procedure = facts.find((fact) => fact.memoryKind === 'procedure');
    const procedureText = JSON.stringify(JSON.parse(procedure?.objectText ?? '{}'));

    expect(facts).toHaveLength(2);
    expect(facts.every((fact) => fact.attributes.stepCount === 60)).toBe(true);
    expect(procedureText).toContain('r:0');
    expect(procedureText).toContain('r:30');
    expect(procedureText).toContain('r:59');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });
});
