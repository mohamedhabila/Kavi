jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  recordStructuredObservationsFromEvidence,
  recordStructuredObservationsFromMessages,
} from '../../../src/services/memory/structuredObservations';
import type { Message } from '../../../src/types/message';

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

function toolMessage(payload: Record<string, unknown>): Message {
  return {
    id: 'tool-1',
    role: 'tool',
    content: JSON.stringify(payload),
    timestamp: 1,
    toolCallId: 'tc-1',
    toolCalls: [
      {
        id: 'tc-1',
        name: 'browser_observe',
        arguments: '{}',
        status: 'completed',
      },
    ],
  };
}

describe('structured observation memory', () => {
  it('records accessibility trees as typed UI, schema, and outcome memories', () => {
    const result = recordStructuredObservationsFromMessages({
      conversationId: 'conv-ui',
      threadId: 'conv-ui',
      taskId: 'task-ui',
      sourceRunId: 'run-ui',
      sourceTurnId: 'assistant-1',
      now: 100,
      messages: [
        toolMessage({
          status: 'completed',
          outcome: 'success',
          url: 'https://app.example.test/settings',
          action: 'click("save")',
          accessibility_tree:
            "RootWebArea 'Settings', focused\n\t[10] button 'Save', clickable, visible\n\t[11] textbox 'Display name', editable, visible",
        }),
      ],
    });

    expect(result.factIds.length).toBeGreaterThanOrEqual(4);
    const affordances = listFacts({ memoryKind: 'ui_affordance', originTaskId: 'task-ui' });
    const schemas = listFacts({ memoryKind: 'surface_schema', originTaskId: 'task-ui' });
    const outcomes = listFacts({ memoryKind: 'outcome', originTaskId: 'task-ui' });
    const inventory = schemas.find((fact) => fact.predicate === 'surface_inventory');

    expect(affordances).toHaveLength(2);
    expect(schemas).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(affordances.some((fact) => fact.objectText.includes('Save'))).toBe(true);
    expect(affordances.every((fact) => fact.scope === 'session')).toBe(true);
    expect(affordances.every((fact) => fact.memoryKind === 'ui_affordance')).toBe(true);
    expect(inventory?.attributes).toMatchObject({
      surfaceId: 'surface:https://app.example.test',
      url: 'https://app.example.test/settings',
      nodeCount: 3,
    });
    expect(() => JSON.parse(inventory!.objectText)).not.toThrow();
  });

  it('prioritizes form controls over generic links in affordance memories', () => {
    const result = recordStructuredObservationsFromMessages({
      conversationId: 'conv-form',
      threadId: 'conv-form',
      sourceRunId: 'run-form',
      now: 300,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/submit',
          accessibility_tree: [
            "RootWebArea 'Submit'",
            "\t[1] link 'Home', clickable, visible",
            "\t[2] link 'Forums', clickable, visible",
            "\t[10] textbox 'Title', editable, visible",
            "\t[11] textbox 'Body', editable, visible",
            "\t[12] combobox 'Forum', clickable, visible",
            "\t[13] button 'Create submission', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    expect(result.factIds.length).toBeGreaterThanOrEqual(1);
    const affordances = listFacts({
      memoryKind: 'ui_affordance',
      originConversationId: 'conv-form',
    });

    expect(affordances.map((fact) => JSON.parse(fact.objectText).name)).toEqual([
      'Title',
      'Body',
      'Forum',
      'Create submission',
    ]);
  });

  it('consumes structured evidence and records typed memories', () => {
    const evidence =
      'agent:' +
      JSON.stringify({
        kind: 'state',
        trajectory_id: 'traj-1',
        state_index: 2,
        outcome: 'failure',
        url: 'https://app.example.test/search',
        accessibility_tree: "[7] searchbox 'Query', clickable, visible",
      });

    const result = recordStructuredObservationsFromEvidence({
      evidence: [evidence],
      conversationId: 'conv-evidence',
      threadId: 'conv-evidence',
      sourceRunId: 'run-evidence',
      now: 200,
    });

    expect(result.consumedEvidence).toEqual([evidence]);
    expect(
      listFacts({ memoryKind: 'ui_affordance', originConversationId: 'conv-evidence' }),
    ).toHaveLength(1);
    expect(
      listFacts({ memoryKind: 'outcome', originConversationId: 'conv-evidence' }),
    ).toHaveLength(1);
  });
});
