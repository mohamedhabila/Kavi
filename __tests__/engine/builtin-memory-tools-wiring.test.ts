import {
  ALL_BUILTIN_TOOL_DEFINITIONS,
  MEMORY_RECALL_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_PIN_TOOL,
  MEMORY_UNPIN_TOOL,
  MEMORY_FORGET_TOOL,
  MEMORY_BLOCK_READ_TOOL,
  MEMORY_BLOCK_EDIT_TOOL,
  MEMORY_MANAGE_TOOL,
  MEMORY_BLOCK_TOOL,
} from '../../src/engine/tools/builtin-definitions';
import {
  executeMemoryRecall,
  executeMemoryRemember,
  executeMemoryPin,
  executeMemoryUnpin,
  executeMemoryForget,
  executeMemoryBlockRead,
  executeMemoryBlockEdit,
} from '../../src/engine/tools/builtin-memory';
import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { ensureDefaultBlocks } from '../../src/services/memory/blocks';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const NEW_MEMORY_TOOL_NAMES = [
  'memory_recall',
  'memory_remember',
  'memory_pin',
  'memory_unpin',
  'memory_forget',
  'memory_block_read',
  'memory_block_edit',
];

const REGISTERED_MEMORY_TOOL_NAMES = [
  'memory_recall',
  'memory_remember',
  'memory_manage',
  'memory_block',
];

const STRUCTURED_MEMORY_CATALOG_TOOL_NAMES = [
  'memory_search',
  'memory_recall',
  'memory_remember',
  'memory_manage',
];

describe('living-memory tool wiring', () => {
  beforeEach(() => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    ensureDefaultBlocks();
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
      MEMORY_BLOCK_READ_TOOL,
      MEMORY_BLOCK_EDIT_TOOL,
      MEMORY_MANAGE_TOOL,
      MEMORY_BLOCK_TOOL,
    ];
    const expected = [...NEW_MEMORY_TOOL_NAMES, 'memory_manage', 'memory_block'].sort();
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

  it('lists structured fact-memory tools under the memory category', async () => {
    const raw = await executeToolCatalog({ category: 'memory' });
    const result = JSON.parse(raw);
    const seen = JSON.stringify(result);
    for (const name of STRUCTURED_MEMORY_CATALOG_TOOL_NAMES) {
      expect(seen).toContain(name);
    }
    expect(seen).not.toContain('memory_block');
  });

  it('memory_remember → memory_recall round-trip via the wrapper executors', () => {
    const remembered = JSON.parse(
      executeMemoryRemember({
        subject: 'user',
        predicate: 'prefers',
        value: 'dark mode',
        confidence: 0.9,
        scope: 'global',
        importance: 0.8,
        sourceSummary: 'User confirmed directly.',
      }),
    );
    expect(remembered.ok).toBe(true);
    expect(remembered.fact.predicate).toBe('prefers');
    expect(remembered.fact.scope).toBe('global');
    expect(remembered.fact.importance).toBe(0.8);

    const recalled = JSON.parse(executeMemoryRecall({ subject: 'user', predicate: 'prefers' }));
    expect(recalled.ok).toBe(true);
    expect(recalled.facts).toHaveLength(1);
    expect(recalled.facts[0].value).toBe('dark mode');
    expect(recalled.facts[0].sourceSummary).toBe('User confirmed directly.');
  });

  it('memory_recall can list all valid facts without a subject hint', () => {
    JSON.parse(executeMemoryRemember({ subject: 'user', predicate: 'tz', value: 'UTC+1' }));
    JSON.parse(executeMemoryRemember({ subject: 'project', predicate: 'name', value: 'Kavi' }));

    const recalled = JSON.parse(executeMemoryRecall({ all: true, limit: 10 }));

    expect(recalled.ok).toBe(true);
    expect(recalled.facts).toHaveLength(2);
  });

  it('memory_pin / memory_unpin flip the pinned flag', () => {
    const r = JSON.parse(
      executeMemoryRemember({ subject: 'user', predicate: 'tz', value: 'UTC+1' }),
    );
    const factId = r.fact.id;

    const pinned = JSON.parse(executeMemoryPin({ factId }));
    expect(pinned.ok).toBe(true);
    expect(pinned.fact.pinned).toBe(true);

    const unpinned = JSON.parse(executeMemoryUnpin({ factId }));
    expect(unpinned.ok).toBe(true);
    expect(unpinned.fact.pinned).toBe(false);
  });

  it('memory_forget invalidates by default-delete and supports invalidate mode', () => {
    const r = JSON.parse(
      executeMemoryRemember({ subject: 'user', predicate: 'name', value: 'Alice' }),
    );
    const factId = r.fact.id;

    const invalidated = JSON.parse(executeMemoryForget({ factId, mode: 'invalidate' }));
    expect(invalidated.ok).toBe(true);
    expect(invalidated.mode).toBe('invalidate');
  });

  it('memory_block_read returns blocks; memory_block_edit replaces content', () => {
    const initial = JSON.parse(executeMemoryBlockRead({}));
    expect(initial.ok).toBe(true);
    expect(Array.isArray(initial.blocks)).toBe(true);

    const target = initial.blocks[0]?.label;
    expect(typeof target).toBe('string');

    const edited = JSON.parse(
      executeMemoryBlockEdit({ label: target, content: 'hello world', replace: true }),
    );
    expect(edited.ok).toBe(true);
    expect(edited.block.content).toBe('hello world');

    const reread = JSON.parse(executeMemoryBlockRead({ label: target }));
    expect(reread.blocks[0].content).toBe('hello world');
  });

  it('returns structured errors as JSON instead of throwing', () => {
    const result = JSON.parse(executeMemoryRemember({ subject: '', predicate: '', value: '' } as any));
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(typeof result.code).toBe('string');
  });
});
