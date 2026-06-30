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
import { recordStructuredObservationsFromMessages } from '../../../src/services/memory/structuredObservations';
import { assemblePrompt } from '../../../src/services/memory/promptAssembly';
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

function toolMessage(payload: Record<string, unknown>, id: string): Message {
  return {
    id,
    role: 'tool',
    content: JSON.stringify(payload),
    timestamp: 1,
    toolCallId: id,
    toolCalls: [
      {
        id,
        name: 'browser_observe',
        arguments: '{}',
        status: 'completed',
      },
    ],
  };
}

describe('structured observation action memory', () => {
  it('keeps surface and visible text evidence on action-result memories', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-action-result-ui-evidence',
      threadId: 'conv-action-result-ui-evidence',
      sourceRunId: 'run-action-result-ui-evidence',
      now: 314,
      messages: [
        toolMessage(
          {
            url: 'https://workflow.example.test/action-result',
            action: "click('qexecute')",
            thought: 'qaction-result-thought',
            accessibility_tree: [
              "RootWebArea 'Action Result'",
              "\t[1] main 'qtarget-surface', visible",
              "\t\t[2] button 'qsave-action', clickable, visible",
              "\t\tStaticText 'qimportant visible result text'",
              "\t\t[3] LabelText '', visible",
              "\t\t\tStaticText 'qfield-label'",
              "\t\t[4] textbox 'qfield-control' value='qfield-value', visible",
            ].join('\n'),
          },
          'tool-action-result-ui-evidence',
        ),
      ],
    });

    const actionResult = listFacts({
      memoryKind: 'outcome',
      originConversationId: 'conv-action-result-ui-evidence',
    }).find((fact) => fact.predicate === 'ui_action_result');
    const parsed = JSON.parse(actionResult?.objectText ?? '{}');

    expect(parsed.surfaceLabels).toEqual(expect.arrayContaining(['qtarget-surface']));
    expect(parsed.visibleTextSnippets).toEqual([
      expect.objectContaining({
        text: 'qimportant visible result text',
        contextLabels: ['qtarget-surface'],
      }),
    ]);
    expect(parsed.actionControls).toEqual([
      expect.objectContaining({
        name: 'qsave-action',
      }),
    ]);
  });

  it('keeps immediate previous event context on action-result memories', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-action-result-previous-event',
      threadId: 'conv-action-result-previous-event',
      sourceRunId: 'run-action-result-previous-event',
      now: 314,
      messages: [
        toolMessage(
          {
            trajectory_id: 'run-action-result-previous-event',
            state_index: 1,
            url: 'https://workflow.example.test/action-result',
            action: "fill('qfield', 'qvalue')",
            thought: 'qprevious-event-thought',
            accessibility_tree: [
              "RootWebArea 'Action Result'",
              "\t[1] main 'qtarget-surface', visible",
              "\t\t[2] textbox 'qfield' value='qvalue', visible",
            ].join('\n'),
          },
          'tool-action-result-previous-event-1',
        ),
        toolMessage(
          {
            trajectory_id: 'run-action-result-previous-event',
            state_index: 2,
            url: 'https://workflow.example.test/action-result',
            action: "select_option('qmode', 'qtarget-mode')",
            thought: 'qmiddle-event-thought',
            accessibility_tree: [
              "RootWebArea 'Action Result'",
              "\t[1] main 'qtarget-surface', visible",
              "\t\t[2] combobox 'qmode' value='qtarget-mode', visible",
            ].join('\n'),
          },
          'tool-action-result-previous-event-2',
        ),
        toolMessage(
          {
            trajectory_id: 'run-action-result-previous-event',
            state_index: 3,
            url: 'https://workflow.example.test/action-result',
            action: "click('qsave-action')",
            thought: 'qcurrent-event-thought',
            accessibility_tree: [
              "RootWebArea 'Action Result'",
              "\t[1] main 'qtarget-surface', visible",
              "\t\t[2] button 'qsave-action', clickable, visible",
            ].join('\n'),
          },
          'tool-action-result-previous-event-3',
        ),
      ],
    });

    const actionResults = listFacts({
      memoryKind: 'outcome',
      originConversationId: 'conv-action-result-previous-event',
    }).filter((fact) => fact.predicate === 'ui_action_result');
    const latest = actionResults.find((fact) => fact.attributes.stateIndex === '3');
    const parsed = JSON.parse(latest?.objectText ?? '{}');

    expect(latest?.attributes).toMatchObject({
      previousAction: "select_option('qmode', 'qtarget-mode')",
      previousThought: 'qmiddle-event-thought',
      previousStateIndex: '2',
    });
    expect(parsed.recentActionTrail).toEqual([
      expect.objectContaining({ stateIndex: '1', action: "fill('qfield', 'qvalue')" }),
      expect.objectContaining({ stateIndex: '2', action: "select_option('qmode', 'qtarget-mode')" }),
    ]);
  });

  it('renders structural action controls into retrieved UI memory prompts', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-prompt-action-controls',
      threadId: 'conv-prompt-action-controls',
      sourceRunId: 'run-prompt-action-controls',
      now: 315,
      messages: [
        toolMessage(
          {
            url: 'https://workflow.example.test/list',
            accessibility_tree: [
              "RootWebArea 'List'",
              "\t[1] region 'toolbar'",
              "\t\t[2] button 'qtoolbar-action', clickable, visible",
              "\t[3] textbox 'qfield-input', editable, visible",
            ].join('\n'),
          },
          'tool-action-controls',
        ),
      ],
    });

    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-prompt-action-controls',
    })[0];
    const sections = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [inventory],
    }).sections;
    const promptText = sections.map((section) => section.text).join('\n');

    expect(promptText).toContain('actionControls');
    expect(promptText).toContain('roleControls');
    expect(promptText).toContain('qtoolbar-action');
    expect(promptText).toContain('"role":"button"');
  });

  it('groups action controls by accessibility role for false-premise UI questions', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-role-controls',
      threadId: 'conv-role-controls',
      sourceRunId: 'run-role-controls',
      now: 320,
      messages: [
        toolMessage(
          {
            url: 'https://workflow.example.test/profile/edit',
            accessibility_tree: [
              "RootWebArea 'Profile'",
              "\t[1] region 'Preview'",
              "\t\t[2] checkbox 'qformat-help', clickable, visible",
              "\t\t[3] button 'qsave', clickable, visible",
              "\t\t[4] link 'qedit-profile', clickable, visible",
            ].join('\n'),
          },
          'tool-role-controls',
        ),
      ],
    });

    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-role-controls',
    })[0];
    const parsed = JSON.parse(inventory.objectText);

    expect(parsed.roleControls.button.map((control: { name: string }) => control.name)).toEqual([
      'qsave',
    ]);
    expect(parsed.roleControls.link.map((control: { name: string }) => control.name)).toEqual([
      'qedit-profile',
    ]);
    expect(parsed.roleControls.checkbox.map((control: { name: string }) => control.name)).toEqual([
      'qformat-help',
    ]);

    const previewGroup = parsed.contextRoleControls.find(
      (group: { label?: string }) => group.label === 'Preview',
    );
    expect(previewGroup.roleControls.button.map((control: { name: string }) => control.name)).toEqual([
      'qsave',
    ]);
    expect(previewGroup.roleControls.link.map((control: { name: string }) => control.name)).toEqual([
      'qedit-profile',
    ]);
  });

  it('preserves field-adjacent controls and valued fields in compact inventories', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-field-adjacent-controls',
      threadId: 'conv-field-adjacent-controls',
      sourceRunId: 'run-field-adjacent-controls',
      now: 321,
      messages: [
        toolMessage(
          {
            url: 'https://workflow.example.test/form',
            accessibility_tree: [
              "RootWebArea 'Form'",
              "\t[1] LabelText ''",
              "\t\tStaticText 'First field'",
              "\t[2] textbox 'First field' value='alpha', clickable, visible",
              "\t[3] LabelText ''",
              "\t\tStaticText 'Target field'",
              "\t[4] combobox 'Target field' value='qtarget-value', clickable, visible, hasPopup='listbox', expanded=False",
              "\t\tStaticText 'qtarget-value'",
              "\t[5] button 'qlookup-target', clickable, visible, hasPopup='menu'",
              "\t[6] link 'qopen-target', clickable, visible",
              "\t[7] button 'qpreview-target', clickable, visible, hasPopup='menu'",
              "\t[8] LabelText ''",
              "\t\tStaticText 'Next field'",
              "\t[9] textbox 'Next field' value='omega', clickable, visible",
              "\t[10] button 'qnext-action', clickable, visible",
            ].join('\n'),
          },
          'tool-field-adjacent-controls',
        ),
      ],
    });

    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-field-adjacent-controls',
    })[0];
    const parsed = JSON.parse(inventory.objectText);
    const targetField = parsed.fields.find(
      (field: { label?: string }) => field.label === 'Target field',
    );

    expect(targetField).toMatchObject({
      label: 'Target field',
      role: 'combobox',
      value: 'qtarget-value',
    });
    expect(
      targetField.adjacentControls.map((control: { name: string }) => control.name),
    ).toEqual(['qlookup-target', 'qopen-target', 'qpreview-target']);
    expect(JSON.stringify(targetField)).not.toContain('qnext-action');
  });

  it('keeps context role groups inside structural sibling section boundaries', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-context-boundaries',
      threadId: 'conv-context-boundaries',
      sourceRunId: 'run-context-boundaries',
      now: 321,
      messages: [
        toolMessage(
          {
            url: 'https://workflow.example.test/profile/edit',
            accessibility_tree: [
              "RootWebArea 'Profile'",
              "\t[1] heading 'qform-section'",
              "\t\t[2] checkbox 'qformat-help', clickable, visible",
              "\t\t[3] button 'qsave', clickable, visible",
              "\t[4] complementary ''",
              "\t\t[5] Section ''",
              "\t\t\t[6] heading 'qprofile-card'",
              "\t\t\t\tStaticText 'qprofile-text'",
              "\t\t\t\t[7] link 'qedit-profile', clickable, visible",
            ].join('\n'),
          },
          'tool-context-boundaries',
        ),
      ],
    });

    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-context-boundaries',
    })[0];
    const parsed = JSON.parse(inventory.objectText);
    const formGroup = parsed.contextRoleControls.find(
      (group: { label?: string }) => group.label === 'qform-section',
    );
    const profileGroup = parsed.contextRoleControls.find(
      (group: { label?: string }) => group.label === 'qprofile-card',
    );

    expect(formGroup.roleControls.button.map((control: { name: string }) => control.name)).toEqual([
      'qsave',
    ]);
    expect(formGroup.roleControls.link).toBeUndefined();
    expect(profileGroup.roleControls.link.map((control: { name: string }) => control.name)).toEqual([
      'qedit-profile',
    ]);
    expect(
      parsed.sections.find((section: { label?: string }) => section.label === 'qprofile-card')
        .textSnippets,
    ).toEqual(['qprofile-text']);
    expect(
      parsed.sections.find((section: { label?: string }) => section.label === 'qprofile-card')
        .structuralPath,
    ).toEqual([{ role: 'complementary' }, { role: 'Section' }]);
  });

  it('does not leak sibling heading context across intervening controls', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-context-label-boundary',
      threadId: 'conv-context-label-boundary',
      sourceRunId: 'run-context-label-boundary',
      now: 322,
      messages: [
        toolMessage(
          {
            url: 'https://workflow.example.test/profile/edit',
            accessibility_tree: [
              "RootWebArea 'Profile'",
              "\t[1] main ''",
              "\t\t[2] heading 'qpreview'",
              "\t\t[3] paragraph ''",
              "\t\t\tStaticText 'qpreview-text'",
              "\t\t[4] checkbox 'qformat-help', clickable, visible",
              "\t\t[5] LabelText '', visible",
              "\t\t\tStaticText 'qformat-help'",
              "\t\t[6] button 'qsave', clickable, visible",
            ].join('\n'),
          },
          'tool-context-label-boundary',
        ),
      ],
    });

    const inventory = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-context-label-boundary',
    })[0];
    const parsed = JSON.parse(inventory.objectText);
    const previewGroup = parsed.contextRoleControls.find(
      (group: { label?: string }) => group.label === 'qpreview',
    );

    expect(previewGroup.roleControls.checkbox.map((control: { name: string }) => control.name)).toEqual([
      'qformat-help',
    ]);
    expect(previewGroup.roleControls.checkbox[0]).toMatchObject({
      label: 'qformat-help',
    });
    expect(previewGroup.roleControls.button).toBeUndefined();
    expect(
      parsed.sections.find((section: { label?: string }) => section.label === 'qpreview')
        .controlNames,
    ).toEqual(['qformat-help']);
    expect(parsed.roleControls.button[0]).toMatchObject({
      name: 'qsave',
    });
    expect(parsed.roleControls.button[0].contextLabels).toBeUndefined();
    expect(parsed.roleControls.button[0].label).toBeUndefined();
  });

  it('records action-result section memory for post-action UI states', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-action-result',
      threadId: 'conv-action-result',
      sourceRunId: 'run-action-result',
      now: 323,
      messages: [
        toolMessage(
          {
            state_index: 2,
            url: 'https://workflow.example.test/profile/edit',
            action: "click('qsave')",
            thought: 'Use qsave to persist qprofile-value.',
            accessibility_tree: [
              "RootWebArea 'Profile'",
              "\t[1] main ''",
              "\t\t[2] heading 'qeditor'",
              "\t\t\t[3] button 'qsave', clickable, visible",
              "\t[4] complementary ''",
              "\t\t[5] Section ''",
              "\t\t\t[6] heading 'qprofile-card'",
              "\t\t\t\tStaticText 'qprofile-value'",
              "\t\t\t\t[7] link 'qedit-profile', clickable, visible",
            ].join('\n'),
          },
          'tool-action-result',
        ),
      ],
    });

    const actionResult = listFacts({
      memoryKind: 'outcome',
      originConversationId: 'conv-action-result',
    }).find((fact) => fact.predicate === 'ui_action_result');
    const parsed = JSON.parse(actionResult?.objectText ?? '{}');

    expect(parsed).toMatchObject({
      action: "click('qsave')",
      stateIndex: '2',
    });
    expect(
      parsed.sections.find((section: { label?: string }) => section.label === 'qprofile-card'),
    ).toMatchObject({
      structuralPath: [{ role: 'complementary' }, { role: 'Section' }],
      textSnippets: ['qprofile-value'],
      controlNames: ['qedit-profile'],
    });
  });

  it('bounds procedure step thoughts for compact action memory', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-procedure-thought',
      threadId: 'conv-procedure-thought',
      sourceRunId: 'run-procedure-thought',
      now: 390,
      messages: [
        toolMessage(
          {
            state_index: 1,
            url: 'https://workflow.example.test/list',
            action: "click('7')",
            thought: `Open the structured editor from qtoolbar-action so the workflow can continue. ${'x'.repeat(600)}`,
            accessibility_tree: [
              "RootWebArea 'List'",
              "\t[7] button 'qtoolbar-action', clickable, visible",
            ].join('\n'),
          },
          'tool-procedure-thought',
        ),
      ],
    });

    const procedure = JSON.parse(
      listFacts({
        memoryKind: 'procedure',
        originConversationId: 'conv-procedure-thought',
      })[0].objectText,
    );

    expect(procedure.steps[0].thought).toContain('qtoolbar-action');
    expect(procedure.steps[0].thought.length).toBeLessThanOrEqual(320);
  });

  it('keeps terminal procedure phases when long traces are compacted', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-procedure-tail',
      threadId: 'conv-procedure-tail',
      sourceRunId: 'run-procedure-tail',
      now: 391,
      messages: Array.from({ length: 64 }, (_, index) =>
        toolMessage(
          {
            state_index: index,
            url: `https://workflow.example.test/step/${index}`,
            action: `click('qaction-${index}')`,
            thought:
              index === 63
                ? `qterminal-procedure-phase ${'terminal detail '.repeat(90)}`
                : `qprocedure-step-${index} ${'procedure detail '.repeat(90)}`,
            accessibility_tree: [
              `RootWebArea 'Step ${index}'`,
              `\t[${index}] button 'qaction-${index}', clickable, visible`,
            ].join('\n'),
          },
          `tool-procedure-tail-${index}`,
        ),
      ),
    });

    const procedure = JSON.parse(
      listFacts({
        memoryKind: 'procedure',
        originConversationId: 'conv-procedure-tail',
      })[0].objectText,
    );

    expect(procedure.stepCount).toBe(64);
    expect(procedure.storedStepCount).toBeLessThan(procedure.stepCount);
    expect(JSON.stringify(procedure).length).toBeLessThanOrEqual(7_500);
    expect(JSON.stringify(procedure.steps)).toContain('qprocedure-step-0');
    expect(JSON.stringify(procedure.steps)).toContain('qterminal-procedure-phase');
  });

  it('does not store user-message narration as environment procedure steps', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-procedure-message-action',
      threadId: 'conv-procedure-message-action',
      sourceRunId: 'run-procedure-message-action',
      now: 392,
      messages: [
        toolMessage(
          {
            state_index: 1,
            url: 'https://workflow.example.test/list',
            action: "click('7')",
            thought: 'Open qtoolbar-action.',
            accessibility_tree: [
              "RootWebArea 'List'",
              "\t[7] button 'qtoolbar-action', clickable, visible",
            ].join('\n'),
          },
          'tool-env-action',
        ),
        toolMessage(
          {
            state_index: 2,
            url: 'https://workflow.example.test/list',
            action: "send_msg_to_user('Done')",
            thought: 'Report completion to the user.',
            accessibility_tree: [
              "RootWebArea 'List'",
              "\t[7] button 'qtoolbar-action', clickable, visible",
            ].join('\n'),
          },
          'tool-message-action',
        ),
      ],
    });

    const procedure = JSON.parse(
      listFacts({
        memoryKind: 'procedure',
        originConversationId: 'conv-procedure-message-action',
      })[0].objectText,
    );

    expect(procedure.steps).toHaveLength(1);
    expect(procedure.steps[0].action).toBe("click('7')");
    expect(JSON.stringify(procedure)).not.toContain('send_msg_to_user');
  });
});
