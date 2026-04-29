// ---------------------------------------------------------------------------
// Tests — Living memory bridge
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
  upsertEntity,
  recordFact,
  setFactPinned,
} from '../../../src/services/memory/factStore';
import {
  ensureDefaultBlocks,
  editBlock,
} from '../../../src/services/memory/blocks';
import { buildLivingMemorySections } from '../../../src/services/memory/livingMemoryBridge';
import type { Message } from '../../../src/types';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  ensureDefaultBlocks();
});

function userMessage(content: string, timestamp: number): Message {
  return {
    id: `u-${timestamp}`,
    role: 'user',
    content,
    timestamp,
  } as Message;
}

function assistantMessage(content: string, timestamp: number): Message {
  return {
    id: `a-${timestamp}`,
    role: 'assistant',
    content,
    timestamp,
  } as Message;
}

describe('buildLivingMemorySections', () => {
  it('returns the empty bridge when no messages are supplied', async () => {
    const out = await buildLivingMemorySections({ messages: [] });
    expect(out.sections).toEqual([]);
    expect(out.recalledFactCount).toBe(0);
    expect(out.openThreadLabels).toEqual([]);
    expect(out.idleSinceLastTurnMs).toBeUndefined();
  });

  it('emits a cacheable L2 section for pinned blocks with content', async () => {
    editBlock('profile', 'Berlin-based developer named Sam.', { replace: true });

    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      now: 2_000,
    });

    expect(out.sections.length).toBeGreaterThan(0);
    const cacheable = out.sections.filter((s) => s.cacheable === true);
    expect(cacheable.length).toBeGreaterThan(0);
    expect(cacheable.map((s) => s.text).join('\n')).toContain('<block label="profile">');
    expect(cacheable.map((s) => s.text).join('\n')).toContain('Berlin-based developer');
  });

  it('omits empty memory blocks from the L2 prefix', async () => {
    // Default blocks are seeded but empty — no L2 section should appear.
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      now: 2_000,
    });
    const cacheable = out.sections.filter((s) => s.cacheable === true);
    expect(cacheable).toEqual([]);
  });

  it('renders a focus block (L3) reflecting the gap since the last assistant turn', async () => {
    const now = 1_000_000;
    const lastAssistantAt = now - 30 * 60 * 1000; // 30 min ago — longer break bucket.
    const messages: Message[] = [
      userMessage('first turn', now - 31 * 60 * 1000),
      assistantMessage('first reply', lastAssistantAt),
      userMessage('back now', now),
    ];

    const out = await buildLivingMemorySections({ messages, now });
    const dynamic = out.sections.filter((s) => !s.cacheable);
    expect(dynamic.length).toBeGreaterThan(0);
    expect(dynamic.map((s) => s.text).join('\n')).toContain('## This Turn');
    expect(out.idleSinceLastTurnMs).toBe(30 * 60 * 1000);
    expect(out.focusGap?.bucket).toBe('longer_break');
  });

  it('passes active_focus and open_threads block content to the focus renderer', async () => {
    const now = 5_000_000;
    editBlock('active_focus', 'Refactor the prompt assembler to use 4 layers.', {
      replace: true,
    });
    editBlock('open_threads', '- Land Chunk J\n- Wire layered budget cascade\n- Add tests', {
      replace: true,
    });

    const out = await buildLivingMemorySections({
      messages: [
        userMessage('q1', now - 60 * 60 * 1000),
        assistantMessage('a1', now - 50 * 60 * 1000),
        userMessage('continue', now),
      ],
      now,
    });

    expect(out.focusBlockText).toContain('Refactor the prompt assembler');
    expect(out.openThreadLabels).toEqual([
      'Land Chunk J',
      'Wire layered budget cascade',
      'Add tests',
    ]);
    const dynamic = out.sections.filter((s) => !s.cacheable);
    const dynamicText = dynamic.map((s) => s.text).join('\n');
    expect(dynamicText).toContain('Refactor the prompt assembler');
  });

  it('appends recalled facts (text-only, lexical match) to the L3 section', async () => {
    const me = upsertEntity({ name: 'user', type: 'self' });
    const fact = recordFact({
      subjectId: me.id,
      predicate: 'lives_in',
      objectText: 'Berlin Berlin Berlin',
    });
    setFactPinned(fact.id, true);
    recordFact({ subjectId: me.id, predicate: 'works_on', objectText: 'OpenClaw mobile' });

    const out = await buildLivingMemorySections({
      messages: [userMessage('Berlin Berlin', 1_000)],
      now: 2_000,
    });

    expect(out.recalledFactCount).toBeGreaterThan(0);
    const dynamicText = out.sections
      .filter((s) => !s.cacheable)
      .map((s) => s.text)
      .join('\n');
    expect(dynamicText).toContain('### Retrieved Memory');
    expect(dynamicText).toContain('Berlin');
  });

  it('skips fact recall entirely when disableRecall is true', async () => {
    const me = upsertEntity({ name: 'user', type: 'self' });
    recordFact({ subjectId: me.id, predicate: 'lives_in', objectText: 'Berlin' });

    const out = await buildLivingMemorySections({
      messages: [userMessage('Where do I live? Berlin', 1_000)],
      now: 2_000,
      disableRecall: true,
    });

    expect(out.recalledFactCount).toBe(0);
  });

  it('produces a stable cacheableSignature for the same inputs (cache hit safety)', async () => {
    editBlock('profile', 'Stable profile content.', { replace: true });

    const messages = [
      userMessage('hello', 1_000),
      assistantMessage('hi', 2_000),
      userMessage('again', 3_000),
    ];

    const a = await buildLivingMemorySections({ messages, now: 4_000 });
    const b = await buildLivingMemorySections({ messages, now: 4_000 });
    expect(a.cacheableSignature).toBe(b.cacheableSignature);
    // The signature reflects only L2 (cacheable) content, so changing the
    // dynamic now-value must not change it.
    const c = await buildLivingMemorySections({ messages, now: 999_999 });
    expect(c.cacheableSignature).toBe(a.cacheableSignature);
  });

  it('tolerates a recall failure by emitting zero retrieved facts (never throws)', async () => {
    const factRecall = require('../../../src/services/memory/factRecall');
    const spy = jest
      .spyOn(factRecall, 'recallFactsForQuery')
      .mockRejectedValueOnce(new Error('embedder offline'));
    try {
      const out = await buildLivingMemorySections({
        messages: [userMessage('something', 1_000)],
        now: 2_000,
      });
      expect(out.recalledFactCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('uses a custom block reader when supplied (test seam)', async () => {
    const out = await buildLivingMemorySections({
      messages: [userMessage('hello', 1_000)],
      now: 2_000,
      readBlocks: () => [
        {
          label: 'profile',
          content: 'Custom reader content.',
          charLimit: 100,
          description: 'desc',
          pinned: true,
          personaId: null,
          updatedAt: 0,
        },
      ],
    });

    const cacheable = out.sections.filter((s) => s.cacheable === true);
    expect(cacheable.map((s) => s.text).join('\n')).toContain('Custom reader content');
  });

  it('falls back to lastUserAt for idle gap when no assistant turn exists', async () => {
    const out = await buildLivingMemorySections({
      messages: [userMessage('first ever turn', 1_000)],
      now: 4_000,
    });
    expect(out.idleSinceLastTurnMs).toBe(3_000);
  });

  it('returns the empty bridge when disableLongTermMemory is true even with persisted blocks/facts', async () => {
    editBlock('profile', 'Berlin-based developer named Sam.', { replace: true });
    const sam = upsertEntity({ name: 'sam', type: 'person' });
    const fact = recordFact({
      subjectId: sam.id,
      predicate: 'lives_in',
      objectText: 'Berlin',
    });
    setFactPinned(fact.id, true);

    const out = await buildLivingMemorySections({
      messages: [userMessage('hello sam Berlin', 1_000)],
      now: 2_000,
      disableLongTermMemory: true,
    });

    expect(out.sections).toEqual([]);
    expect(out.recalledFactCount).toBe(0);
    expect(out.openThreadLabels).toEqual([]);
    expect(out.idleSinceLastTurnMs).toBeUndefined();
  });
});
