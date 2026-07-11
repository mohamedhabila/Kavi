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

describe('recordAgentRunEvidenceMemory', () => {
  it('does not consume non-json graph evidence that belongs to durable fact bridging', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: ['python:artifact:reports/analysis.json'],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(0);
    expect(result.factIds).toHaveLength(0);
    expect(listFacts({ originConversationId: 'conv-agent-memory' })).toHaveLength(0);
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
      now: 10,
    });

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    expect(facts.some((fact) => fact.memoryKind === 'evidence_span')).toBe(true);
    expect(agentRun?.confidence).toBeGreaterThan(0.8);
    expect(agentRun?.retrievability).toBeGreaterThan(0.8);
  });

  it('keeps bounded observed tool output inside compact run memories', () => {
    const observedState = [
      'window',
      'heading "Review changes"',
      'button "Submit"',
      'status "Ready"',
      'metadata '.repeat(500),
    ].join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-observed',
        state_index: 3,
        action: 'Inspect the current screen',
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

    expect(result.consumedEvidence).toHaveLength(1);
    expect(result.factIds.length).toBeGreaterThan(1);

    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    expect(facts.filter((fact) => fact.memoryKind === 'agent_run')).toHaveLength(1);
    expect(facts.filter((fact) => fact.memoryKind === 'evidence_span')).toHaveLength(1);

    const joined = facts.map((fact) => fact.objectText).join('\n');
    expect(joined).toContain('"observation"');
    expect(joined).toContain('Submit');
    expect(joined).toContain('Ready');
    expect(joined).not.toContain('"surfaceControls"');
    expect(joined).not.toContain('"actionInventory"');
    expect(joined.length).toBeLessThan(12_500);
  });

  it('preserves local observed control neighborhoods inside compact evidence spans', () => {
    const observedState = [
      ...Array.from({ length: 33 }, (_, index) => `[nav-${index}] link 'nav:${index}', visible`),
      "[col-0] columnheader 'col:0', visible",
      "[col-1] columnheader 'col:1', visible",
      "[col-2] columnheader 'col:2', visible",
      "[col-3] columnheader 'col:3', visible",
      ...Array.from({ length: 8 }, (_, index) => `[tail-${index}] button 'tail:${index}', visible`),
    ].join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-local-controls',
        state_index: 3,
        action: 'Inspect the current surface',
        accessibility_tree: observedState,
        toolName: 'mobile_state',
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
    const spanRecords = facts
      .filter((fact) => fact.memoryKind === 'evidence_span')
      .map((fact) => JSON.parse(fact.objectText) as Record<string, unknown>);
    const labels = spanRecords.flatMap((record) =>
      Array.isArray(record.observedControlSequence)
        ? record.observedControlSequence.map((entry) =>
            typeof entry === 'object' && entry !== null
              ? String((entry as Record<string, unknown>).label ?? '')
              : '',
          )
        : [],
    );
    const anchorIndex = labels.indexOf('col:2');

    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    expect(labels[anchorIndex + 1]).toBe('col:3');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('preserves prioritized exact affordance evidence from dense tool observations', () => {
    const observedState = [
      ...Array.from({ length: 120 }, (_, index) => `[noise-${index}] StaticText 'row ${index}'`),
      ...Array.from({ length: 30 }, (_, index) => `[option-${index}] option 'Generic ${index}'`),
      "[menu-1] menuitem 'Incident Mobile', visible",
      "[menu-2] menuitem 'Incident Portal', visible",
      "[menu-3] menuitem 'My Open Incidents', visible",
      "[button-1] button 'Apply', clickable, visible",
    ].join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-affordance',
        state_index: 11,
        action: 'Open the current control menu',
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

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    const affordanceLabels = (agentRunRecord.evidenceSlices ?? []).flatMap(
      (step: Record<string, unknown>) =>
        Array.isArray(step.observedAffordances)
          ? step.observedAffordances.map((entry: Record<string, unknown>) => entry.label)
          : [],
    );

    expect(affordanceLabels).toEqual(
      expect.arrayContaining(['Incident Mobile', 'Incident Portal', 'My Open Incidents']),
    );
    expect(JSON.stringify(agentRunRecord)).toContain('"inputControlsPresent":false');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('preserves adjacent accessibility annotations on matching controls', () => {
    const observedState = [
      "RootWebArea 'Project Form'",
      "[field-label] LabelText '', visible",
      "[field-note] note 'Locked by policy', visible",
      "StaticText 'Project code'",
      "[field-input] textbox 'Project code' value='ALPHA-7', clickable, visible",
    ].join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-annotation',
        state_index: 3,
        action: 'Inspect project form',
        accessibility_tree: observedState,
        toolName: 'browser_state',
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
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    const affordances = (agentRunRecord.evidenceSlices ?? []).flatMap(
      (step: Record<string, unknown>) =>
        Array.isArray(step.observedAffordances) ? step.observedAffordances : [],
    ) as Array<Record<string, unknown>>;
    const projectCode = affordances.find((entry) => entry.label === 'Project code');

    expect(projectCode?.attributes).toContain("note='Locked by policy'");
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

  it('retains dense option states ahead of repeated generic controls', () => {
    const evidence = Array.from({ length: 40 }, (_, index) => {
      const accessibilityTree =
        index === 17
          ? [
              "RootWebArea 'Records'",
              "[menu-1] menuitem 'Incident Mobile', visible",
              "[menu-2] menuitem 'Incident Portal', visible",
              "[menu-3] menuitem 'My Open Incidents', visible",
            ].join('\n')
          : [
              "RootWebArea 'Records'",
              "[search-1] combobox 'Search', clickable, visible",
              `[button-${index}] button 'Next ${index}', clickable, visible`,
            ].join('\n');
      return `agent:${JSON.stringify({
        trajectory_id: 'run-dense-menu',
        state_index: index,
        action: `Inspect step ${index}`,
        accessibility_tree: accessibilityTree,
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

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    const rendered = JSON.stringify(agentRunRecord);
    expect(rendered).toContain('Incident Mobile');
    expect(rendered).toContain('Incident Portal');
    expect(rendered).toContain('My Open Incidents');
  });

  it('keeps adjacent structured affordances when compacting long agent-run memories', () => {
    const fillerObservation = Array.from(
      { length: 140 },
      (_, line) => `[noise-${line}] StaticText 'background row ${line}'`,
    ).join('\n');
    const evidence = Array.from({ length: 18 }, (_, index) => {
      const accessibilityTree =
        index === 12
          ? [
              "RootWebArea 'Records'",
              ...Array.from(
                { length: 14 },
                (_, optionIndex) =>
                  `[menu-${optionIndex}] menuitem 'Generic ${optionIndex}', visible`,
              ),
              "[menu-14] menuitem 'Incident Mobile', visible",
              "[menu-15] menuitem 'Incident Portal', visible",
              "[menu-16] menuitem 'My Open Incidents', visible",
              ...Array.from(
                { length: 120 },
                (_, line) => `[noise-${line}] StaticText 'background row ${line}'`,
              ),
            ].join('\n')
          : fillerObservation;
      return `agent:${JSON.stringify({
        trajectory_id: 'run-affordance-compaction',
        state_index: index,
        goal: 'Complete a long observed workflow while retaining compact structural evidence for later agent reasoning.',
        action: `Inspect step ${index}`,
        thought:
          'The assistant is observing the current state and preserving the controls that may matter for a later follow-up.',
        accessibility_tree: accessibilityTree,
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

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    const rendered = JSON.stringify(agentRunRecord);
    expect(agentRunRecord.goal).toBe(
      'Complete a long observed workflow while retaining compact structural evidence for later agent reasoning.',
    );
    expect(rendered).toContain('Incident Mobile');
    expect(rendered).toContain('Incident Portal');
    expect(rendered).toContain('My Open Incidents');
    expect(agentRun?.objectText.length).toBeLessThanOrEqual(10_000);
  });

  it('keeps representative lines from long observed tool output', () => {
    const observedState = Array.from({ length: 90 }, (_, index) =>
      index === 45
        ? 'field-marker-midrun-checkbox is visible and unchecked'
        : `observed line ${index}`,
    ).join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-distributed-observation',
        state_index: 8,
        action: 'Inspect long structured output',
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

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const joined = facts.map((fact) => fact.objectText).join('\n');
    expect(joined).toContain('field-marker-midrun-checkbox');
    expect(joined).toContain('observed line 0');
    expect(joined).toContain('observed line 87');
    expect(joined.length).toBeLessThan(12_500);
  });

  it('keeps local observed relationships from long structured tool output', () => {
    const observedState = Array.from({ length: 280 }, (_, index) => {
      if (index === 92) return "[control-1] toggle 'Auto approve' value='off'";
      if (index === 93) return "[control-2] input 'Approver' value='Ada Lovelace'";
      return `structured output line ${index}`;
    }).join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-local-relationship',
        state_index: 10,
        action: 'Inspect structured tool state',
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

    expect(result.factIds.length).toBeGreaterThan(1);
    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const joined = facts.map((fact) => fact.objectText).join('\n');
    expect(joined).toContain("toggle 'Auto approve'");
    expect(joined).toContain("input 'Approver'");
    expect(joined.length).toBeLessThan(12_500);
  });

  it('retains temporally distributed observations from long agent runs', () => {
    const evidence = Array.from({ length: 100 }, (_, index) => {
      const observedState =
        index === 71
          ? 'middle workflow checkpoint: approval record is ready'
          : index === 72
            ? 'waypoint workflow checkpoint: follow-up state is visible'
            : `step ${index} observed state`;
      return [
        `agent:${JSON.stringify({
          trajectory_id: 'run-long',
          state_index: index,
          goal: 'Complete a long approval workflow and preserve why each observed state mattered.',
          toolName: 'browser_state',
          status: 'completed',
        })}`,
        `agent:${JSON.stringify({
          trajectory_id: 'run-long',
          state_index: index,
          goal: 'Complete a long approval workflow and preserve why each observed state mattered.',
          action: `Continue workflow step ${index}`,
          url: `https://example.com/workflows/${index}?source=${'path-'.repeat(40)}`,
          accessibility_tree: observedState,
          status: 'completed',
        })}`,
      ];
    }).flat();

    const result = recordAgentRunEvidenceMemory({
      evidence,
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceTurnId: 'assistant-1',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(200);
    expect(result.factIds.length).toBeGreaterThan(1);

    const facts = listFacts({ originConversationId: 'conv-agent-memory' });
    const joined = facts.map((fact) => fact.objectText).join('\n');
    expect(joined).toContain('middle workflow checkpoint');
    const agentRun = facts.find((fact) => fact.memoryKind === 'agent_run');
    expect(agentRun?.attributes.stepCount).toBe(100);
    expect(agentRun?.objectText).toContain('middle workflow checkpoint');
    const agentRunRecord = JSON.parse(agentRun?.objectText ?? '{}');
    expect(Array.isArray(agentRunRecord.evidenceSlices)).toBe(true);
    expect(agentRunRecord.evidenceSlices.length).toBeGreaterThan(1);
    expect(
      agentRunRecord.evidenceSlices.some((step: Record<string, unknown>) => step.observation),
    ).toBe(true);
    expect(
      agentRunRecord.evidenceSlices.some((step: Record<string, unknown>) =>
        String(step.action ?? '').includes('Continue workflow step'),
      ),
    ).toBe(true);
    expect(
      agentRunRecord.evidenceSlices.some((step: Record<string, unknown>) =>
        String(step.observation ?? '').includes('waypoint workflow checkpoint'),
      ),
    ).toBe(true);
    expect(
      agentRunRecord.evidenceSlices.some((step: Record<string, unknown>) =>
        String(step.observation ?? '').includes('step 99 observed state'),
      ),
    ).toBe(true);
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
      const record = JSON.parse(fact.objectText) as Record<string, unknown>;
      expect(record).toMatchObject({ sourceRunId: 'run-long' });
      if (fact.memoryKind === 'agent_run') {
        expect(record.goal).toBe(
          'Complete a long approval workflow and preserve why each observed state mattered.',
        );
      } else {
        expect(record).not.toHaveProperty('goal');
        expect(record).not.toHaveProperty('thought');
        expect(record).not.toHaveProperty('action');
        expect(record).not.toHaveProperty('outcome');
      }
    }
  });

  it('preserves distributed observed affordance labels in compact run records', () => {
    const accessibilityTree = [
      ...Array.from(
        { length: 18 },
        (_, index) => `[${100 + index}] button 'Primary action ${index}', clickable, visible`,
      ),
      ...Array.from(
        { length: 18 },
        (_, index) => `[${140 + index}] link 'Navigation item ${index}', clickable, visible`,
      ),
      ...Array.from(
        { length: 17 },
        (_, index) => `[${180 + index}] heading 'Context section ${index}', visible`,
      ),
      "[220] heading 'Late evidence section', visible",
      "[221] link 'Late section action', clickable, visible",
    ].join('\n');
    const evidence = [
      `agent:${JSON.stringify({
        trajectory_id: 'run-affordance-spread',
        state_index: 1,
        action: 'Inspect available actions',
        toolName: 'browser_state',
        accessibility_tree: accessibilityTree,
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
    const joined = facts.map((fact) => fact.objectText).join('\n');
    expect(joined).toContain('Late evidence section');
    expect(joined).toContain('Late section action');
    expect(joined).toContain('"section":"Late evidence section"');
    for (const fact of facts) {
      expect(fact.objectText.length).toBeLessThanOrEqual(10_000);
    }
  });

  it('does not create empty run records from unrelated json payloads', () => {
    const result = recordAgentRunEvidenceMemory({
      evidence: [`agent:${JSON.stringify({ trajectory_id: 'run-empty', value: 42 })}`],
      conversationId: 'conv-agent-memory',
      threadId: 'conv-agent-memory',
      taskId: 'task-analysis',
      sourceRunId: 'fallback-run',
      now: 10,
    });

    expect(result.consumedEvidence).toHaveLength(0);
    expect(result.factIds).toHaveLength(0);
    expect(listFacts({ originConversationId: 'conv-agent-memory' })).toHaveLength(0);
  });
});
