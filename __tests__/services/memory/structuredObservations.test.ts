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

    expect(result.factIds.length).toBeGreaterThanOrEqual(7);
    const affordances = listFacts({ memoryKind: 'ui_affordance', originTaskId: 'task-ui' });
    const controls = listFacts({ memoryKind: 'ui_control', originTaskId: 'task-ui' });
    const inventories = listFacts({ memoryKind: 'ui_inventory', originTaskId: 'task-ui' });
    const schemas = listFacts({ memoryKind: 'surface_schema', originTaskId: 'task-ui' });
    const outcomes = listFacts({ memoryKind: 'outcome', originTaskId: 'task-ui' });
    const inventory = inventories.find((fact) => fact.predicate === 'ui_inventory');

    expect(affordances).toHaveLength(2);
    expect(controls).toHaveLength(2);
    expect(inventories).toHaveLength(1);
    expect(schemas).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(affordances.some((fact) => fact.objectText.includes('Save'))).toBe(true);
    expect(affordances.every((fact) => fact.scope === 'session')).toBe(true);
    expect(affordances.every((fact) => fact.memoryKind === 'ui_affordance')).toBe(true);
    expect(inventory?.attributes).toMatchObject({
      surfaceId: 'surface:https://app.example.test',
      url: 'https://app.example.test/settings',
      nodeCount: 3,
      controlCount: 2,
      textEntryCount: 1,
    });
    expect(() => JSON.parse(inventory!.objectText)).not.toThrow();
  });

  it('records label-control field relations and complete page inventories', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-ui-graph',
      threadId: 'conv-ui-graph',
      sourceRunId: 'run-ui-graph',
      now: 400,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/submit',
          accessibility_tree: [
            "RootWebArea 'Submit'",
            "\t[1] link 'Home', clickable, visible",
            "\t[2] searchbox 'Search query', clickable, visible",
            "\t[10] LabelText '', visible",
            "\t\tStaticText 'Title'",
            "\t\tStaticText '*'",
            "\t[11] textbox 'Title This field is required.', visible, required",
            "\t[12] LabelText '', visible",
            "\t\tStaticText 'Body'",
            "\t[13] textbox 'Body', visible",
            "\t[14] checkbox 'Formatting help +', clickable, checked='false'",
            "\t[15] LabelText '', visible",
            "\t\tStaticText 'Destination'",
            "\t\tStaticText '*'",
            "\t[16] combobox 'general' value='general', clickable, hasPopup='menu'",
            "\t[17] button 'Create submission', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const fields = listFacts({
      memoryKind: 'ui_field',
      originConversationId: 'conv-ui-graph',
    }).map((fact) => JSON.parse(fact.objectText));
    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-ui-graph',
    })[0];
    const inventoryObject = JSON.parse(inventory.objectText);

    expect(fields.map((field) => field.label)).toEqual(['Title', 'Body', 'Destination']);
    expect(fields.map((field) => field.role)).toEqual(['textbox', 'textbox', 'combobox']);
    expect(fields[2]).toMatchObject({
      label: 'Destination',
      controlName: 'general',
      value: 'general',
      required: true,
    });
    expect(inventoryObject).toMatchObject({
      controlCount: 7,
      textEntryCount: 2,
      searchControlCount: 1,
    });
    expect(inventoryObject.controls.some((control: { name?: string }) => control.name === 'Formatting help +')).toBe(
      true,
    );
  });

  it('records generic label-value state for active filters without phrase rules', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-filter-state',
      threadId: 'conv-filter-state',
      sourceRunId: 'run-filter-state',
      now: 500,
      messages: [
        toolMessage({
          url: 'https://admin.example.test/orders',
          accessibility_tree: [
            "RootWebArea 'Orders'",
            "\tStaticText 'Order state:'",
            "\tStaticText 'Archived'",
            "\t[10] button 'Clear active state', clickable",
            "\t[11] textbox 'Search by keyword', value='Avery', clickable",
            "\t[12] button 'Filters', clickable",
          ].join('\n'),
        }),
      ],
    });

    const labelValues = listFacts({
      memoryKind: 'ui_filter_state',
      originConversationId: 'conv-filter-state',
    }).map((fact) => JSON.parse(fact.objectText));

    expect(labelValues).toEqual([
      expect.objectContaining({
        label: 'Order state',
        value: 'Archived',
        sourceRunId: 'run-filter-state',
      }),
    ]);
  });

  it('records actionable affordance memories in source order without role priority', () => {
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
      'Home',
      'Forums',
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
