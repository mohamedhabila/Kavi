jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/database';
import { listFacts } from '../../src/services/memory/facts/queries';
import {
  executeMemoryPreserveSource,
  PRESERVED_SOURCE_TEXT_MAX_BYTES,
} from '../../src/services/memory/memoryPreserveSource';
import { executeMemoryForget } from '../../src/services/memory/memoryTools';
import { resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { memoryRememberExecution } from '../helpers/memoryRememberExecution';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

function execution(userMessageText: string, overrides: Record<string, unknown> = {}) {
  return memoryRememberExecution({
    userMessageId: 'source-message-1',
    userMessageText,
    sourceRunId: 'agent-run-source-1',
    ...overrides,
  });
}

describe('executeMemoryPreserveSource', () => {
  it('persists one exact global source with code-owned provenance and replay identity', () => {
    const text = [
      'Preserve the Aurora operating brief for later conversations.',
      'Aurora operating brief',
      'Owner: Field Operations',
      'Review marker: quartz-ember-482',
    ].join('\n');
    const context = execution(text);
    const args = {
      title: 'Aurora operating brief',
      sensitivity: 'normal' as const,
    };

    const first = executeMemoryPreserveSource(args, context);
    const replay = executeMemoryPreserveSource(args, context);

    expect(first).toMatchObject({ ok: true, status: 'created' });
    expect(replay).toMatchObject({ ok: true, fact: { id: first.ok ? first.fact.id : '' } });
    expect(first).toMatchObject({
      fact: {
        title: 'Aurora operating brief',
        predicate: 'preserved_source',
        scope: 'global',
        sensitivity: 'normal',
        contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        sourceByteLength: new TextEncoder().encode(text).byteLength,
      },
    });
    expect(first.ok ? first.fact : {}).not.toHaveProperty('value');
    const facts = listFacts({ memoryKind: 'source' });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      id: first.ok ? first.fact.id : '',
      predicate: 'preserved_source',
      scope: 'global',
      originConversationId: null,
      originThreadId: null,
      originTaskId: null,
      memoryKind: 'source',
      factClass: 'workflow',
      sourceAuthority: 'grounded_user',
      sourceMessageId: 'source-message-1',
      sourceRunId: 'agent-run-source-1',
      reviewState: 'verified',
      sensitivity: 'normal',
    });
    expect(JSON.parse(facts[0]!.objectText)).toEqual({
      version: 1,
      title: 'Aurora operating brief',
      content: text,
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('withdraws a preserved source through the existing fact deletion flow', () => {
    const text = 'Save Project Cedar source for later.\nProject Cedar source\nMarker: delta-17';
    const context = execution(text);
    const preserved = executeMemoryPreserveSource(
      {
        title: 'Project Cedar source',
        sensitivity: 'normal',
      },
      context,
    );
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;

    const forgotten = executeMemoryForget(
      { factId: preserved.fact.id },
      {
        memoryConversationId: context.requestEvidence.memoryConversationId,
        sourceThreadId: context.requestEvidence.sourceThreadId,
        personaId: 'default',
        taskId: null,
      },
    );

    expect(forgotten).toMatchObject({ ok: true, status: 'withdrawn' });
    expect(listFacts({ memoryKind: 'source' })).toEqual([]);
  });

  it.each([
    {
      name: 'a title not copied from the current user message',
      text: 'Preserve this source for later.',
      args: { title: 'Invented title', sensitivity: 'normal' },
      code: 'grounding_required',
    },
    {
      name: 'a provider-selected narrower scope',
      text: 'Preserve Project brief.\nProject brief',
      args: { title: 'Project brief', scope: 'project', sensitivity: 'normal' },
      code: 'invalid_args',
    },
    {
      name: 'provider-declared restricted content',
      text: 'Preserve Restricted source.\nRestricted source',
      args: { title: 'Restricted source', sensitivity: 'restricted' },
      code: 'permission_denied',
    },
  ])('rejects $name without writing', ({ text, args, code }) => {
    expect(executeMemoryPreserveSource(args as never, execution(text))).toMatchObject({
      ok: false,
      code,
    });
    expect(listFacts()).toEqual([]);
  });

  it('rejects an oversized current source before persistence', () => {
    const title = 'Oversized source';
    const text = `${title}\n${'x'.repeat(PRESERVED_SOURCE_TEXT_MAX_BYTES)}`;

    expect(
      executeMemoryPreserveSource({ title, sensitivity: 'normal' }, execution(text)),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(listFacts()).toEqual([]);
  });

  it('rejects a source whose encoded record exceeds the canonical contribution limit', () => {
    const title = 'Encoding-heavy source';
    const text = `${title}\n${'"'.repeat(9_000)}`;

    expect(
      executeMemoryPreserveSource({ title, sensitivity: 'normal' }, execution(text)),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(listFacts()).toEqual([]);
  });

  it('honors long-term-memory opt-out before creating an entity or fact', () => {
    const text = 'Disabled source\nDo not persist this.';
    useSettingsStore.setState({ disableLongTermMemory: true });

    expect(
      executeMemoryPreserveSource(
        { title: 'Disabled source', sensitivity: 'normal' },
        execution(text),
      ),
    ).toMatchObject({ ok: false, code: 'memory_disabled' });
    useSettingsStore.setState({ disableLongTermMemory: false });
    expect(listFacts()).toEqual([]);
  });
});
