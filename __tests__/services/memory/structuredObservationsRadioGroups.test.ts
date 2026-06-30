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
    id: 'tool-radio-groups',
    role: 'tool',
    content: JSON.stringify(payload),
    timestamp: 1,
    toolCallId: 'tool-radio-groups',
    toolCalls: [
      {
        id: 'tool-radio-groups',
        name: 'browser_observe',
        arguments: '{}',
        status: 'completed',
      },
    ],
  };
}

describe('structured observation radio groups', () => {
  it('preserves sibling radio options as grouped form fields', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-radio-groups',
      threadId: 'conv-radio-groups',
      sourceRunId: 'run-radio-groups',
      now: 500,
      messages: [
        toolMessage({
          url: 'https://workflow.example.test/configure',
          accessibility_tree: [
            "RootWebArea 'Configure'",
            "\t[1] region 'qproduct'",
            "\t\t[2] radiogroup 'qgroup-alpha'",
            "\t\t\t[3] radio 'qalpha-one', checked='true'",
            "\t\t\t[4] LabelText ''",
            "\t\t\t\tStaticText 'qalpha-one'",
            "\t\t\t[5] radio 'qalpha-two', checked='false'",
            "\t\t\t[6] LabelText ''",
            "\t\t\t\tStaticText 'qalpha-two'",
            "\t\t[7] radiogroup 'qgroup-beta'",
            "\t\t\t[8] radio 'qbeta-one', checked='true'",
            "\t\t\t[9] radio 'qbeta-two', checked='false'",
            "\t\t[10] LabelText ''",
            "\t\t\tStaticText 'qquantity'",
            "\t\t[11] combobox 'qquantity' value='1', hasPopup='menu'",
            "\t\t\t[12] option '1', selected=True",
            "\t\t\t[13] option '2', selected=False",
          ].join('\n'),
        }),
      ],
    });

    const inventory = JSON.parse(
      listFacts({
        memoryKind: 'ui_inventory',
        originConversationId: 'conv-radio-groups',
      })[0].objectText,
    );

    expect(inventory.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'qgroup-alpha',
          role: 'radiogroup',
          value: 'qalpha-one',
          options: ['qalpha-one', 'qalpha-two'],
        }),
        expect.objectContaining({
          label: 'qgroup-beta',
          role: 'radiogroup',
          value: 'qbeta-one',
          options: ['qbeta-one', 'qbeta-two'],
        }),
      ]),
    );
    expect(inventory.fieldLabels).toEqual(
      expect.arrayContaining(['qgroup-alpha', 'qgroup-beta', 'qquantity']),
    );
  });
});
