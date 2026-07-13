import {
  ALL_BUILTIN_TOOL_DEFINITIONS,
  MEMORY_RECALL_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_PIN_TOOL,
  MEMORY_UNPIN_TOOL,
  MEMORY_FORGET_TOOL,
  MEMORY_MANAGE_TOOL,
} from '../../src/engine/tools/builtin-definitions';
import {
  executeMemoryRecall,
  executeMemoryRemember,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryForget,
  executeMemoryInvalidate,
} from '../../src/engine/tools/builtin-memory';

import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { memoryRememberExecution } from '../helpers/memoryRememberExecution';

const MEMORY_EXECUTION_SCOPE = {
  memoryConversationId: 'memory-tools-conversation',
  sourceThreadId: 'memory-tools-thread',
  personaId: 'default',
  taskId: null,
} as const;

function groundedRequest(userMessageId: string, userMessageText: string) {
  return memoryRememberExecution({
    memoryConversationId: MEMORY_EXECUTION_SCOPE.memoryConversationId,
    sourceThreadId: MEMORY_EXECUTION_SCOPE.sourceThreadId,
    userMessageId,
    userMessageText,
  });
}

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const NEW_MEMORY_TOOL_NAMES = [
  'memory_recall',
  'memory_remember',
  'memory_pin',
  'memory_unpin',
  'memory_forget',
];

const REGISTERED_MEMORY_TOOL_NAMES = [
  'memory_recall',
  'memory_remember',
  'memory_forget',
  'memory_manage',
];

const STRUCTURED_MEMORY_CATALOG_TOOL_NAMES = [
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_forget',
  'memory_manage',
];

describe('living-memory tool wiring', () => {
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

  it('exports a ToolDefinition for each new memory tool', () => {
    const defs = [
      MEMORY_RECALL_TOOL,
      MEMORY_REMEMBER_TOOL,
      MEMORY_PIN_TOOL,
      MEMORY_UNPIN_TOOL,
      MEMORY_FORGET_TOOL,
      MEMORY_MANAGE_TOOL,
    ];
    const expected = [...NEW_MEMORY_TOOL_NAMES, 'memory_manage'].sort();
    expect(defs.map((d) => d.name).sort()).toEqual(expected);
    for (const def of defs) {
      expect(typeof def.description).toBe('string');
      expect(def.input_schema.type).toBe('object');
    }
  });

  it('registers all new memory tools in ALL_BUILTIN_TOOL_DEFINITIONS', () => {
    const names = new Set(ALL_BUILTIN_TOOL_DEFINITIONS.map((t) => t.name));
    for (const name of REGISTERED_MEMORY_TOOL_NAMES) {
      expect(names.has(name)).toBe(true);
    }
  });

  it('declares exact label preservation for structured memory writes', () => {
    expect(MEMORY_REMEMBER_TOOL.description).toContain('Preserve user-supplied subject');
    expect(MEMORY_REMEMBER_TOOL.description).toContain('do not rename predicates');
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties.subject.description).toContain(
      'Exact entity label supplied by the user',
    );
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties.predicate.description).toContain(
      'Exact relation/predicate label supplied by the user',
    );
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties.value.description).toContain(
      'Exact object text/value supplied by the user',
    );
  });

  it('keeps withdrawal and correction as separate strict contracts', () => {
    expect(MEMORY_FORGET_TOOL.input_schema.properties).not.toHaveProperty('mode');
    expect(MEMORY_FORGET_TOOL.input_schema.additionalProperties).toBe(false);
    expect(MEMORY_FORGET_TOOL.contract).toEqual(
      expect.objectContaining({
        sideEffects: ['destructive'],
        riskHints: expect.arrayContaining(['destructive', 'requires_approval']),
      }),
    );
    expect(MEMORY_MANAGE_TOOL.input_schema.properties).not.toHaveProperty('mode');
    expect(MEMORY_MANAGE_TOOL.input_schema.properties.action.enum).toEqual([
      'pin',
      'unpin',
      'invalidate',
    ]);
    expect(MEMORY_MANAGE_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it('keeps runtime-owned memory provenance out of the provider-facing write schema', () => {
    expect(MEMORY_REMEMBER_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(['subject', 'predicate', 'value', 'scope']),
    );
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties).not.toHaveProperty('originConversationId');
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties).not.toHaveProperty('originThreadId');
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties).not.toHaveProperty('originTaskId');
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties).not.toHaveProperty('sourceMessageId');
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties).not.toHaveProperty('sourceRunId');
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties).not.toHaveProperty('requestEvidence');
    expect(MEMORY_REMEMBER_TOOL.input_schema.additionalProperties).toBe(false);
    expect(MEMORY_REMEMBER_TOOL.input_schema.properties).toHaveProperty('sourceSummary');
    expect(MEMORY_RECALL_TOOL.input_schema.properties).not.toHaveProperty('originConversationId');
    expect(MEMORY_RECALL_TOOL.input_schema.properties).not.toHaveProperty('originTaskId');
    expect(MEMORY_RECALL_TOOL.input_schema.properties).not.toHaveProperty('includeHistory');
    expect(MEMORY_RECALL_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it('lists structured fact-memory tools under the memory category', async () => {
    const raw = await executeToolCatalog({ category: 'memory' });
    const result = JSON.parse(raw);
    const seen = JSON.stringify(result);
    for (const name of STRUCTURED_MEMORY_CATALOG_TOOL_NAMES) {
      expect(seen).toContain(name);
    }
  });

  it('memory_remember → memory_recall round-trip via the wrapper executors', () => {
    const remembered = JSON.parse(
      executeMemoryRemember(
        {
          subject: 'user',
          predicate: 'preference',
          value: 'dark mode',
          confidence: 0.9,
          scope: 'global',
          importance: 0.8,
          sourceSummary: 'User confirmed directly.',
        },
        groundedRequest('user-prefers', 'I prefer dark mode.'),
      ),
    );
    expect(remembered.ok).toBe(true);
    expect(remembered.fact.predicate).toBe('preference');
    expect(remembered.fact.scope).toBe('global');
    expect(remembered.fact.importance).toBe(0.8);

    const recalled = JSON.parse(
      executeMemoryRecall({ subject: 'user', predicate: 'preference' }, MEMORY_EXECUTION_SCOPE),
    );
    expect(recalled.ok).toBe(true);
    expect(recalled.facts).toHaveLength(1);
    expect(recalled.facts[0].value).toBe('dark mode');
    expect(recalled.facts[0].sourceSummary).toBe('User confirmed directly.');
    expect(recalled.facts[0].policy).toEqual({ action: 'use', reason: 'eligible' });
  });

  it('memory_recall can list all valid facts without a subject hint', () => {
    JSON.parse(
      executeMemoryRemember(
        {
          subject: 'user',
          subjectType: 'self',
          predicate: 'usual architecture review duration',
          value: '30 minutes',
          scope: 'global',
        },
        groundedRequest(
          'user-review-duration',
          'I usually keep architecture reviews to 30 minutes.',
        ),
      ),
    );
    JSON.parse(
      executeMemoryRemember(
        { subject: 'project', predicate: 'name', value: 'Kavi', scope: 'global' },
        groundedRequest('user-project-name', 'project name is Kavi.'),
      ),
    );

    const recalled = JSON.parse(
      executeMemoryRecall({ all: true, limit: 10 }, MEMORY_EXECUTION_SCOPE),
    );

    expect(recalled.ok).toBe(true);
    expect(recalled.facts).toHaveLength(2);
    expect(recalled.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predicate: 'usual architecture review duration' }),
        expect.objectContaining({ predicate: 'name' }),
      ]),
    );
    expect(
      recalled.facts.every((fact: { policy: { action: string } }) => fact.policy.action === 'use'),
    ).toBe(true);
  });

  it('memory_pin / memory_unpin flip the pinned flag', () => {
    const r = JSON.parse(
      executeMemoryRemember(
        { subject: 'user', predicate: 'timezone', value: 'UTC+1', scope: 'global' },
        groundedRequest('user-timezone', 'My timezone is UTC+1.'),
      ),
    );
    const factId = r.fact.id;

    const pinned = JSON.parse(executeMemoryPin({ factId }, MEMORY_EXECUTION_SCOPE));
    expect(pinned.ok).toBe(true);
    expect(pinned.fact.pinned).toBe(true);

    const unpinned = JSON.parse(executeMemoryUnpin({ factId }, MEMORY_EXECUTION_SCOPE));
    expect(unpinned.ok).toBe(true);
    expect(unpinned.fact.pinned).toBe(false);
  });

  it('memory_forget withdraws without returning the private value', () => {
    const r = JSON.parse(
      executeMemoryRemember(
        { subject: 'user', predicate: 'name', value: 'Alice', scope: 'global' },
        groundedRequest('user-name-forget', 'My name is Alice.'),
      ),
    );
    const factId = r.fact.id;

    const withdrawn = JSON.parse(executeMemoryForget({ factId }, MEMORY_EXECUTION_SCOPE));
    expect(withdrawn.ok).toBe(true);
    expect(withdrawn.action).toBe('withdrawal');
    expect(JSON.stringify(withdrawn)).not.toContain('Alice');
  });

  it('memory invalidation preserves correction history through its own executor', () => {
    const r = JSON.parse(
      executeMemoryRemember(
        { subject: 'user', predicate: 'name', value: 'Alice', scope: 'global' },
        groundedRequest('user-name-invalidate', 'My name is Alice.'),
      ),
    );
    const invalidated = JSON.parse(
      executeMemoryInvalidate({ factId: r.fact.id }, MEMORY_EXECUTION_SCOPE),
    );
    expect(invalidated).toEqual(
      expect.objectContaining({ ok: true, action: 'invalidation', status: 'invalidated' }),
    );
  });

  it('returns structured errors as JSON instead of throwing', () => {
    const result = JSON.parse(
      executeMemoryRemember(
        { subject: '', predicate: '', value: '', scope: 'global' } as any,
        groundedRequest('user-invalid-memory', 'Invalid memory request.'),
      ),
    );
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(typeof result.code).toBe('string');
  });
});
