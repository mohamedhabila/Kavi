jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { assemblePrompt } from '../../../src/services/memory/promptAssembly';
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
  expoSqlite.__resetExpoSqliteForTests();
});

function toolMessage(payload: Record<string, unknown>): Message {
  return {
    id: 'tool-boolean-fields',
    role: 'tool',
    content: JSON.stringify(payload),
    timestamp: 1,
    toolCallId: 'tc-boolean-fields',
    toolCalls: [
      {
        id: 'tc-boolean-fields',
        name: 'browser_observe',
        arguments: '{}',
        status: 'completed',
      },
    ],
  };
}

describe('structured observation boolean fields', () => {
  it('records checkbox controls as queryable fields with checked state', () => {
    recordStructuredObservationsFromMessages({
      conversationId: 'conv-boolean-fields',
      threadId: 'conv-boolean-fields',
      sourceRunId: 'run-boolean-fields',
      now: 500,
      messages: [
        toolMessage({
          url: 'https://workflow.example.test/settings',
          accessibility_tree: [
            "RootWebArea 'Settings'",
            "\t[10] heading 'Settings'",
            "\t[1] checkbox 'qactive-field', clickable, visible, checked='true'",
            "\t[2] checkbox 'qnotes-field', clickable, visible, checked='false'",
            "\t[3] textbox 'qname-field', editable, visible",
          ].join('\n'),
        }),
      ],
    });

    const inventoryFact = listFacts({
      memoryKind: 'ui_inventory',
      originConversationId: 'conv-boolean-fields',
    })[0];
    const inventory = JSON.parse(inventoryFact.objectText);
    const fieldFacts = listFacts({
      memoryKind: 'ui_field',
      originConversationId: 'conv-boolean-fields',
    }).map((fact) => JSON.parse(fact.objectText));

    expect(inventory.fieldLabels).toEqual(
      expect.arrayContaining(['qactive-field', 'qnotes-field', 'qname-field']),
    );
    expect(inventory.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'qactive-field',
          role: 'checkbox',
          checked: 'true',
        }),
        expect.objectContaining({
          label: 'qnotes-field',
          role: 'checkbox',
          checked: 'false',
        }),
      ]),
    );
    expect(fieldFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'qactive-field',
          role: 'checkbox',
          surfaceLabels: ['Settings'],
        }),
      ]),
    );

    const promptText = assemblePrompt({
      basePrompt: 'base',
      retrievedFacts: [inventoryFact],
    }).sections.map((section) => section.text).join('\n');

    expect(promptText).toContain('"label":"qactive-field"');
    expect(promptText).toContain('"role":"checkbox"');
    expect(promptText).toContain('"checked":"true"');
  });
});
