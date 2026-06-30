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
  it('records accessibility trees as typed UI inventory and outcome memories', () => {
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
          goal: 'Update settings page controls',
          trajectory_outcome: 'success',
          domain: 'mobile-app',
          environment: 'test',
          url: 'https://app.example.test/settings',
          action: 'click("save")',
          accessibility_tree:
            "RootWebArea 'Settings', focused\n\t[10] button 'Save', clickable, visible\n\t[11] textbox 'Display name', editable, visible",
        }),
      ],
    });

    expect(result.factIds.length).toBeGreaterThanOrEqual(2);
    const inventories = listFacts({ memoryKind: 'ui_inventory', originTaskId: 'task-ui' });
    const outcomes = listFacts({ memoryKind: 'outcome', originTaskId: 'task-ui' });
    const inventory = inventories.find((fact) => fact.predicate === 'ui_inventory');
    const actionResult = outcomes.find((fact) => fact.predicate === 'ui_action_result');

    expect(inventories).toHaveLength(1);
    expect(listFacts({ memoryKind: 'ui_affordance', originTaskId: 'task-ui' })).toHaveLength(0);
    expect(outcomes.map((fact) => fact.predicate).sort()).toEqual([
      'tool_outcome',
      'ui_action_result',
    ]);
    expect(inventory?.objectText).toContain('Save');
    expect(JSON.parse(actionResult!.objectText)).not.toHaveProperty('goal');
    expect(actionResult?.attributes.goal).toBe('Update settings page controls');
    expect(actionResult?.attributes.trajectoryOutcome).toBe('success');
    expect(JSON.parse(inventory!.objectText)).toMatchObject({
      goal: 'Update settings page controls',
      trajectoryOutcome: 'success',
      domain: 'mobile-app',
      environment: 'test',
    });
    expect(inventories.every((fact) => fact.scope === 'session')).toBe(true);
    expect(inventories.every((fact) => fact.memoryKind === 'ui_inventory')).toBe(true);
    expect(inventory?.attributes).toMatchObject({
      surfaceId: 'surface:https://app.example.test',
      url: 'https://app.example.test/settings',
      nodeCount: 3,
      controlCount: 2,
      textEntryCount: 1,
    });
    expect(() => JSON.parse(inventory!.objectText)).not.toThrow();
  });

  it('records actionable controls inside compact inventories with structural context', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-affordance',
      threadId: 'conv-affordance',
      sourceRunId: 'run-affordance',
      now: 250,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/f/general',
          accessibility_tree: [
            "RootWebArea 'Forum'",
            "\t[1] Section ''",
            "\t\t[2] heading 'qsection-actions'",
            "\t\t[3] list ''",
            "\t\t\t[4] listitem ''",
            "\t\t\t\t[5] link 'qaction-alpha', clickable, visible",
            "\t\t\t[6] listitem ''",
            "\t\t\t\t[7] link 'qaction-beta', clickable, visible",
            "\t\t\t[8] listitem ''",
            "\t\t\t\t[9] link 'qaction-gamma', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-affordance',
      })[0].objectText,
    );
    const controls = inventory.controls;

    expect(listFacts({
      memoryKind: 'ui_affordance',
      originConversationId: 'conv-affordance',
    })).toHaveLength(0);

    expect(controls.map((control: { name?: string }) => control.name)).toEqual([
      'qaction-alpha',
      'qaction-beta',
      'qaction-gamma',
    ]);
    expect(controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'qaction-beta',
          role: 'link',
          contextLabels: ['qsection-actions'],
        }),
      ]),
    );
    expect(inventory.actionControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'qaction-beta',
          role: 'link',
          contextLabels: ['qsection-actions'],
        }),
      ]),
    );
    expect(inventory.sourceRunId).toBe('run-affordance');
  });

  it('records named clickable non-control roles without treating labels as controls', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-clickable-role',
      threadId: 'conv-clickable-role',
      sourceRunId: 'run-clickable-role',
      now: 275,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/f/general',
          accessibility_tree: [
            "RootWebArea 'Forum'",
            "\t[1] complementary ''",
            "\t\t[2] DisclosureTriangle 'Advanced options', clickable, visible, expanded=False",
            "\t\t[3] LabelText 'Decorative helper', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-clickable-role',
      })[0].objectText,
    );

    expect(listFacts({
      memoryKind: 'ui_affordance',
      originConversationId: 'conv-clickable-role',
    })).toHaveLength(0);
    expect(inventory.controlNames).toEqual(['Advanced options']);
    expect(inventory.controls.map((control: { name?: string }) => control.name)).toEqual([
      'Advanced options',
    ]);
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
            "\t\t[161] option 'general', selected=True",
            "\t\t[162] option 'news', selected=False",
            "\t[17] button 'Create submission', clickable, visible",
            "\t[18] LabelText 'Decorative helper', clickable, visible",
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
      options: ['general', 'news'],
      required: true,
    });
    expect(inventoryObject).toMatchObject({
      controlCount: 9,
      textEntryCount: 2,
      searchControlCount: 1,
      fieldLabels: ['Title', 'Body', 'Destination'],
    });
    expect(
      inventoryObject.controls.find(
        (control: { role?: string; name?: string }) =>
          control.role === 'combobox' && control.name === 'general',
      ),
    ).toMatchObject({ options: ['general', 'news'] });
    expect(inventoryObject.popupControls).toEqual([
      expect.objectContaining({
        role: 'combobox',
        name: 'general',
        options: ['general', 'news'],
      }),
    ]);
    expect(inventoryObject.actionControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'link', name: 'Home' }),
        expect.objectContaining({ role: 'button', name: 'Create submission' }),
      ]),
    );
    expect(
      inventoryObject.actionControls.some(
        (control: { role?: string; name?: string }) =>
          control.role === 'textbox' && control.name === 'Body',
      ),
    ).toBe(false);
    expect(inventoryObject.controls.some((control: { name?: string }) => control.name === 'Formatting help +')).toBe(
      true,
    );
    expect(inventoryObject.controls.some((control: { role?: string }) => control.role === 'LabelText')).toBe(
      false,
    );
    expect(inventoryObject.controlNames).toEqual(
      expect.arrayContaining(['Home', 'Search query', 'Title This field is required.', 'Body']),
    );
    expect(inventoryObject.searchControls).toEqual([
      expect.objectContaining({ role: 'searchbox', name: 'Search query' }),
    ]);
    expect(inventoryObject.textEntryControls).toEqual([
      expect.objectContaining({ role: 'textbox', label: 'Title' }),
      expect.objectContaining({ role: 'textbox', label: 'Body' }),
    ]);
  });

  it('records sibling-rendered popup menu options without absorbing following content', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-popup-sibling',
      threadId: 'conv-popup-sibling',
      sourceRunId: 'run-popup-sibling',
      now: 405,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/f/qscope',
          accessibility_tree: [
            "RootWebArea 'qpage'",
            "\t[1] main '', visible",
            "\t\t[2] navigation '', visible",
            "\t\t\t[3] list '', visible",
            "\t\t\t\t[4] listitem '', visible",
            "\t\t\t\t\t[5] button 'qsort-current', clickable, visible, hasPopup='menu', expanded=True",
            "\t\t\t\t\t\tStaticText 'qsort-current'",
            "\t\t\t\t\t[6] list '', visible",
            "\t\t\t\t\t\t[7] listitem '', visible",
            "\t\t\t\t\t\t\t[8] link 'qmenu-alpha', clickable, visible",
            "\t\t\t\t\t\t[9] listitem '', visible",
            "\t\t\t\t\t\t\t[10] link 'qmenu-beta', clickable, visible",
            "\t\t[11] article '', visible",
            "\t\t\t[12] heading 'qpost-title', visible",
            "\t\t\t\t[13] link 'qpost-title', clickable, visible",
            "\t\t[14] navigation '', visible",
            "\t\t\t[15] list '', visible",
            "\t\t\t\t[16] listitem '', visible",
            "\t\t\t\t\t[17] button 'qclosed-popup', clickable, visible, hasPopup='menu', expanded=False",
            "\t\t\t\t\t[18] list '', visible",
            "\t\t\t\t\t\t[19] listitem '', visible",
            "\t\t\t\t\t\t\t[20] link 'qclosed-follower', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-popup-sibling',
      })[0].objectText,
    );

    expect(inventory.popupControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          name: 'qsort-current',
          options: ['qmenu-alpha', 'qmenu-beta'],
        }),
      ]),
    );
    const expandedPopup = inventory.popupControls.find(
      (control: { name?: string }) => control.name === 'qsort-current',
    );
    expect(expandedPopup.options).not.toContain('qpost-title');

    const popupFacts = listFacts({
      memoryKind: 'ui_field',
      originConversationId: 'conv-popup-sibling',
    });
    expect(popupFacts.map((fact) => fact.predicate)).toEqual(['ui_popup_options']);
    expect(JSON.parse(popupFacts[0].objectText)).toMatchObject({
      role: 'button',
      name: 'qsort-current',
      controlName: 'qsort-current',
      options: ['qmenu-alpha', 'qmenu-beta'],
    });
    expect(popupFacts[0].objectText).not.toContain('qclosed-follower');
  });

  it('records named UI sections with their contained controls', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-ui-sections',
      threadId: 'conv-ui-sections',
      sourceRunId: 'run-ui-sections',
      now: 410,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/user/current',
          accessibility_tree: [
            "RootWebArea 'Profile'",
            "\t[1] Section '', visible",
            "\t\t[2] heading 'qsection-alpha', visible",
            "\t\t[3] list '', visible",
            "\t\t\t[4] listitem '', visible",
            "\t\t\t\t[5] link 'qsection-action-one', clickable, visible",
            "\t\t\t[6] listitem '', visible",
            "\t\t\t\t[7] link 'qsection-action-two', clickable, visible",
            "\t[8] Section '', visible",
            "\t\t[9] heading 'qsection-beta', visible",
            "\t\t[10] list '', visible",
            "\t\t\t[11] listitem '', visible",
            "\t\t\t\t[12] link 'qsection-action-three', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-ui-sections',
      })[0].objectText,
    );

    expect(inventory.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'qsection-alpha',
          controlNames: ['qsection-action-one', 'qsection-action-two'],
        }),
        expect.objectContaining({
          label: 'qsection-beta',
          controlNames: ['qsection-action-three'],
        }),
      ]),
    );
  });

  it('keeps large UI inventories parseable while preserving field structure', () => {
    const bulkControls = Array.from(
      { length: 80 },
      (_, index) =>
        `\t[${200 + index}] button 'bulk-control-${index}-${'x'.repeat(
          180,
        )}', clickable, visible`,
    );

    recordStructuredObservationsFromMessages({
      conversationId: 'conv-large-ui',
      threadId: 'conv-large-ui',
      sourceRunId: 'run-large-ui',
      now: 425,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/submit/funny',
          accessibility_tree: [
            "RootWebArea 'Submit'",
            "\t[10] LabelText '', visible",
            "\t\tStaticText 'Title'",
            "\t[11] textbox 'Title', editable, visible",
            "\t[12] LabelText '', visible",
            "\t\tStaticText 'Body'",
            "\t[13] textbox 'Body', editable, visible",
            "\t[14] LabelText '', visible",
            "\t\tStaticText 'Forum'",
            "\t[15] combobox 'funny' value='funny', clickable, hasPopup='menu'",
            "\t\t[151] option 'general', selected=False",
            "\t\t[152] option 'funny', selected=True",
            ...bulkControls,
            "\t[390] button 'late-critical-action', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-large-ui',
    })[0];
    const inventoryObject = JSON.parse(inventory.objectText);

    expect(inventory.objectText.length).toBeLessThanOrEqual(4_000);
    expect(listFacts({
      memoryKind: 'ui_affordance',
      originConversationId: 'conv-large-ui',
    })).toHaveLength(0);
    expect(inventoryObject.fieldLabels).toEqual(expect.arrayContaining(['Title']));
    expect(inventoryObject.controlNames).toContain('late-critical-action');
    expect(inventoryObject.actionControls.length).toBeLessThanOrEqual(48);
    expect(inventoryObject.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Body', role: 'textbox' }),
        expect.objectContaining({
          label: 'Forum',
          role: 'combobox',
          options: ['general', 'funny'],
        }),
      ]),
    );
  });

  it('records visible symbol markers attached to field options', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-field-symbols',
      threadId: 'conv-field-symbols',
      sourceRunId: 'run-field-symbols',
      now: 430,
      messages: [
        toolMessage({
          url: 'https://forum.example.test/submit/pittsburgh',
          accessibility_tree: [
            "RootWebArea 'Create submission'",
            "\t[1] LabelText '', visible",
            "\t\tStaticText 'Forum'",
            "\t\tStaticText '*'",
            "\t[2] combobox 'pittsburgh' value='pittsburgh', clickable, visible, hasPopup='menu'",
            "\t\t[3] textbox 'pittsburgh ❤️' value='pittsburgh', visible",
            "\t\t\tStaticText 'pittsburgh'",
            "\t\t\t[4] image '', visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-field-symbols',
    })[0].objectText);
    const forumField = inventory.fields.find((field: { label?: string }) => field.label === 'Forum');

    expect(forumField).toMatchObject({
      label: 'Forum',
      role: 'combobox',
      value: 'pittsburgh',
      displayText: 'pittsburgh ❤️',
      options: ['pittsburgh ❤️'],
      symbolMarkers: [{ glyph: '❤️', source: 'displayText', text: 'pittsburgh ❤️' }],
    });

    const fieldFact = JSON.parse(listFacts({
      memoryKind: 'ui_field',
      originConversationId: 'conv-field-symbols',
    })[0].objectText);
    expect(fieldFact).toMatchObject({
      label: 'Forum',
      displayText: 'pittsburgh ❤️',
      symbolMarkers: [{ glyph: '❤️', source: 'displayText', text: 'pittsburgh ❤️' }],
    });
  });

  it('preserves controls in source order inside compact inventories', () => {
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
    const inventories = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-form',
    });
    const inventory = JSON.parse(inventories[0].objectText);

    expect(inventory.controls.map((control: { name: string }) => control.name)).toEqual([
      'Home',
      'Forums',
      'Title',
      'Body',
      'Forum',
      'Create submission',
    ]);
    expect(inventory.actionControls.map((control: { name: string }) => control.name)).toEqual([
      'Home',
      'Forums',
      'Create submission',
    ]);
    expect(inventory.roleControls).toMatchObject({
      link: [
        expect.objectContaining({ name: 'Home' }),
        expect.objectContaining({ name: 'Forums' }),
      ],
      button: [expect.objectContaining({ name: 'Create submission' })],
    });
  });

  it('stores consecutive observations as standalone UI inventories', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-transition-context',
      threadId: 'conv-transition-context',
      sourceRunId: 'run-transition-context',
      now: 375,
      messages: [
        toolMessage({
          state_index: 1,
          url: 'https://workflow.example.test/input',
          action: null,
          thought: 'Use qtransition-submit after entering qtransition-field.',
          accessibility_tree: [
            "RootWebArea 'Input'",
            "\t[1] button 'qtransition-submit', clickable, visible",
            "\t[2] textbox 'qtransition-field', editable, visible",
          ].join('\n'),
        }),
        toolMessage({
          state_index: 2,
          url: 'https://workflow.example.test/result',
          action: "click('1')",
          thought: 'Open qresult-alpha for the result details.',
          accessibility_tree: [
            "RootWebArea 'Result'",
            "\t[3] heading 'qsection-result'",
            "\t[4] link 'qresult-alpha', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventories = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-transition-context',
    });
    const parsedInventories = inventories.map((fact) => JSON.parse(fact.objectText));
    const inputInventory = parsedInventories.find(
      (payload) => payload.url === 'https://workflow.example.test/input',
    );
    const resultInventory = parsedInventories.find(
      (payload) => payload.url === 'https://workflow.example.test/result',
    );

    expect(inputInventory.controlNames).toEqual(
      expect.arrayContaining(['qtransition-submit', 'qtransition-field']),
    );
    expect(resultInventory).toMatchObject({
      url: 'https://workflow.example.test/result',
      stateIndex: '2',
    });
    expect(resultInventory).not.toHaveProperty('action');
    expect(resultInventory).not.toHaveProperty('thought');
    expect(resultInventory).not.toHaveProperty('previousUrl');
    expect(resultInventory).not.toHaveProperty('previousStateIndex');
    expect(resultInventory).not.toHaveProperty('previousControlNames');

    const procedure = listFacts({
      memoryKind: 'procedure',
      originConversationId: 'conv-transition-context',
    })[0];
    expect(JSON.parse(procedure.objectText)).toMatchObject({
      sourceRunId: 'run-transition-context',
      stepCount: 2,
      steps: [
        expect.objectContaining({
          stateIndex: '1',
          url: 'https://workflow.example.test/input',
          thought: expect.stringContaining('qtransition-submit'),
        }),
        expect.objectContaining({
          stateIndex: '2',
          url: 'https://workflow.example.test/result',
          action: "click('1')",
          thought: expect.stringContaining('qresult-alpha'),
        }),
      ],
    });
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
    expect(listFacts({ memoryKind: 'ui_inventory', originConversationId: 'conv-evidence' })).toHaveLength(1);
    expect(
      listFacts({ memoryKind: 'outcome', originConversationId: 'conv-evidence' }),
    ).toHaveLength(1);
  });
});
