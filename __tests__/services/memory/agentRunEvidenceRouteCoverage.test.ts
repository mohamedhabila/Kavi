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

function expectStoredAgentRunWithEvidenceSpans(facts: ReturnType<typeof listFacts>) {
  const agentRuns = facts.filter((fact) => fact.memoryKind === 'agent_run');
  const evidenceSpans = facts.filter((fact) => fact.memoryKind === 'evidence_span');
  expect(agentRuns).toHaveLength(1);
  expect(evidenceSpans.length).toBeGreaterThan(0);
  expect(evidenceSpans.length).toBeLessThanOrEqual(8);
  return agentRuns[0];
}

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
    const agentRun = expectStoredAgentRunWithEvidenceSpans(facts);
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    const sequence = agentRunRecord.evidenceSlices?.[0]?.observedControlSequence ?? [];
    const expectRepresentativeOrderedControls = (sequence: Array<Record<string, unknown>>) => {
      const labels = sequence.map((entry) => String(entry.label ?? ''));
      const controlIndexes = labels
        .map((label) => /^c:(\d+)$/.exec(label)?.[1])
        .filter((index): index is string => index !== undefined)
        .map((index) => Number(index));
      expect(controlIndexes).toEqual([...controlIndexes].sort((left, right) => left - right));
      expect(labels).toContain('c:0');
      expect(labels).toContain('c:20');
      expect(controlIndexes.some((index) => index >= 37)).toBe(true);
      expect(labels).toContain('h:name');
      expect(labels).toContain('h:owner');
    };

    expectRepresentativeOrderedControls(sequence);
    expect(JSON.stringify(agentRunRecord)).toContain('"observedAffordances"');
    expect(JSON.stringify(agentRunRecord)).toContain('"observedControlSequence"');
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

    expect(result.factIds.length).toBeGreaterThan(0);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = expectStoredAgentRunWithEvidenceSpans(facts);
    const agentRunText = JSON.stringify(JSON.parse(agentRun?.objectText ?? '{}'));

    expect(agentRunText).toContain('m:0');
    expect(agentRunText).toContain('m:30');
    expect(agentRunText).toContain('m:59');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('retains representative observed controls from long same-surface runs', () => {
    const evidence = Array.from({ length: 60 }, (_, index) => {
      const marker =
        index === 0 ? 'r:0' : index === 30 ? 'r:30' : index === 59 ? 'r:59' : `r:${index}`;
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

    expect(result.factIds.length).toBeGreaterThan(0);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = expectStoredAgentRunWithEvidenceSpans(facts);
    const agentRunText = JSON.stringify(JSON.parse(agentRun?.objectText ?? '{}'));

    expect(facts.every((fact) => fact.attributes.stepCount === 60)).toBe(true);
    expect(agentRunText).toContain('r:0');
    expect(agentRunText).toMatch(/r:(2[5-9]|3[0-5])/);
    expect(agentRunText).toContain('r:59');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('preserves visited surface anchors when source-heavy steps dominate a compact run', () => {
    const denseSourceState = (index: number) =>
      [
        `RootWebArea 'source:${index}'`,
        ...Array.from(
          { length: 32 },
          (_entry, controlIndex) =>
            `[${index}-${controlIndex}] menuitem 'source:${index}:${controlIndex}', visible`,
        ),
        ...Array.from(
          { length: 120 },
          (_entry, lineIndex) => `[noise-${index}-${lineIndex}] StaticText 'row ${lineIndex}'`,
        ),
      ].join('\n');
    const targetState = [
      "RootWebArea 'target surface'",
      "[target-heading] heading 'target title', visible",
      ...Array.from(
        { length: 4 },
        (_entry, controlIndex) =>
          `[target-${controlIndex}] button 'toolbar-${controlIndex}', clickable, visible`,
      ),
      "[target-create] button 'target-create', clickable, visible",
      "[target-reset] button 'target-reset', clickable, visible",
      "[target-export] button 'target-export', clickable, visible",
      ...Array.from(
        { length: 4 },
        (_entry, controlIndex) =>
          `[target-tail-${controlIndex}] button 'toolbar-tail-${controlIndex}', clickable, visible`,
      ),
      ...Array.from(
        { length: 12 },
        (_entry, columnIndex) =>
          `[target-column-${columnIndex}] columnheader 'column-${columnIndex}', visible`,
      ),
    ].join('\n');
    const routeTransitions: ReadonlyArray<readonly [number, string]> = [
      [0, '/home'],
      [2, '/tasks'],
      [7, '/tasks/136'],
      [8, '/tasks/index/136'],
      [13, '/jobs'],
      [15, '/tasks'],
      [17, '/jobs'],
      [19, '/tasks'],
      [26, '/tasks/226'],
      [27, '/tasks/index/226'],
      [31, '/workspace/people/index'],
      [34, '/tasks'],
      [37, '/tasks/222'],
      [38, '/workspace/people/index/edit/id/10'],
      [39, '/workspace/people/index/edit/id/10#summary'],
      [40, '/workspace/people/index'],
      [42, '/tasks'],
      [43, '/tasks/226'],
      [44, '/tasks/index/226'],
      [45, '/tasks/226'],
      [46, '/tasks/index/226'],
      [47, '/tasks/226'],
      [48, '/tasks/index/226'],
      [49, '/tasks/226'],
      [50, '/tasks/index/226'],
    ];
    const routeForStep = (index: number): string => {
      const transition = [...routeTransitions]
        .reverse()
        .find(([transitionIndex]) => index >= transitionIndex);
      return `https://app.example.test${transition?.[1] ?? '/home'}`;
    };
    const evidence = Array.from({ length: 51 }, (_, index) => {
      const isTargetSurface = index === 38;
      return `agent:${JSON.stringify({
        trajectory_id: 'run-surface-anchor',
        state_index: index,
        action: `inspect surface ${index}`,
        url: routeForStep(index),
        accessibility_tree: isTargetSurface ? targetState : denseSourceState(index),
        toolName: 'mobile_state',
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

    expect(result.factIds.length).toBeGreaterThan(0);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = expectStoredAgentRunWithEvidenceSpans(facts);
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    const rendered = JSON.stringify(agentRunRecord);

    expect(rendered).toContain('target-create');
    expect(rendered).toContain('target-reset');
    expect(rendered).toContain('target-export');
    expect(
      agentRunRecord.evidenceSlices.some((step: Record<string, unknown>) => step.stateIndex === 38),
    ).toBe(true);
    expect(agentRun?.objectText.length).toBeLessThanOrEqual(10_000);
  });
});
