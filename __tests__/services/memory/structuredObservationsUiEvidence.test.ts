jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { recordStructuredObservationsFromMessages } from '../../../src/services/memory/structuredObservations';
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

describe('structured observation UI evidence', () => {
  it('associates detached listbox options with the expanded field instead of adjacent buttons', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-detached-listbox',
      threadId: 'conv-detached-listbox',
      sourceRunId: 'run-detached-listbox',
      now: 407,
      messages: [
        toolMessage({
          url: 'https://workflow.example.test/form',
          accessibility_tree: [
            "RootWebArea 'qform'",
            "\t[1] Section '', visible",
            "\t\t[2] region 'qform-section', visible",
            "\t\t\t[3] LabelText '', visible",
            "\t\t\t\tStaticText 'qcategory-label'",
            "\t\t\t[4] combobox 'qcategory-control' value='qselected-value', clickable, visible, focused, hasPopup='listbox', expanded=True",
            "\t\t\t\tStaticText 'qselected-value'",
            "\t\t\t[5] button 'qlookup-button', clickable, visible, hasPopup='menu'",
            "\t\t\t[6] LabelText '', visible",
            "\t\t\t\tStaticText 'qnext-label'",
            "\t\t\t[7] textbox 'qnext-control', visible",
            "\t[20] listbox '', visible",
            "\t\t[21] option 'qoption-alpha', clickable, visible, selected=False",
            "\t\t[22] option 'qoption-beta', clickable, visible, selected=False",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-detached-listbox',
      })[0].objectText,
    );
    const field = inventory.fields.find(
      (entry: { label?: string }) => entry.label === 'qcategory-label',
    );

    expect(field).toMatchObject({
      label: 'qcategory-label',
      role: 'combobox',
      controlName: 'qcategory-control',
      value: 'qselected-value',
      options: ['qoption-alpha', 'qoption-beta'],
    });
    expect(field.options).not.toContain('qlookup-button');
    expect(field.displayText).toBeUndefined();
    expect(inventory.popupControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'qcategory-control',
          options: ['qoption-alpha', 'qoption-beta'],
        }),
      ]),
    );
  });

  it('records visible non-control text snippets from form surfaces', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-visible-text',
      threadId: 'conv-visible-text',
      sourceRunId: 'run-visible-text',
      now: 408,
      messages: [
        toolMessage({
          url: 'https://workflow.example.test/form-note',
          accessibility_tree: [
            "RootWebArea 'qform'",
            "\t[1] main 'qmain-surface', visible",
            "\t\t[2] button 'qsave-action', clickable, visible",
            "\t\tStaticText 'qimportant visible instruction for this form'",
            "\t\t[3] LabelText '', visible",
            "\t\t\tStaticText 'qfield-label'",
            "\t\t[4] textbox 'qfield-control', visible",
            "\t\t[5] table '', visible",
            "\t\t\t[6] row 'qtable-row-text'",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-visible-text',
      })[0].objectText,
    );

    expect(inventory.visibleTextSnippets).toEqual([
      expect.objectContaining({
        text: 'qimportant visible instruction for this form',
        contextLabels: ['qmain-surface'],
      }),
    ]);
    expect(JSON.stringify(inventory.visibleTextSnippets)).not.toContain('qfield-label');
    expect(JSON.stringify(inventory.visibleTextSnippets)).not.toContain('qtable-row-text');
  });

  it('promotes section landmark roles for layout-sensitive UI evidence', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-section-landmarks',
      threadId: 'conv-section-landmarks',
      sourceRunId: 'run-section-landmarks',
      now: 409,
      messages: [
        toolMessage({
          url: 'https://workflow.example.test/profile/edit',
          accessibility_tree: [
            "RootWebArea 'Profile'",
            "\t[1] main ''",
            "\t\t[2] heading 'qpreview'",
            "\t\t\tStaticText 'qpreview-text'",
            "\t\t[3] checkbox 'qformat-help', clickable, visible",
            "\t[4] complementary ''",
            "\t\t[5] Section ''",
            "\t\t\t[6] heading 'qprofile-card'",
            "\t\t\t\tStaticText 'qprofile-text'",
            "\t\t\t\t[7] link 'qedit-profile', clickable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-section-landmarks',
      })[0].objectText,
    );
    const sectionByLabel = new Map(
      inventory.sections.map((section: { label: string }) => [section.label, section]),
    );

    expect(sectionByLabel.get('qpreview')).toMatchObject({
      landmarkRole: 'main',
      structuralPath: [{ role: 'main' }],
    });
    expect(sectionByLabel.get('qprofile-card')).toMatchObject({
      landmarkRole: 'complementary',
      structuralPath: [{ role: 'complementary' }, { role: 'Section' }],
      controlNames: ['qedit-profile'],
    });
  });
});
