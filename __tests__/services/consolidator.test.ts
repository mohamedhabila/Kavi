// ---------------------------------------------------------------------------
// Tests — Memory consolidator (single-pass extractor + persistence)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
  ensureDefaultBlocks,
  getBlock,
  listFacts,
  findEntityByName,
} from '../../src/services/memory/factStore';
import {
  buildConsolidatorPrompt,
  parseConsolidatorOutput,
  applyConsolidatorResult,
  consolidateTurn,
  type ConsolidatorExtractor,
} from '../../src/services/memory/consolidator';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

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

describe('buildConsolidatorPrompt', () => {
  it('includes thread title, persona, user, assistant blocks', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'I just moved to Berlin.',
      assistantMessage: 'Nice — anything you want help setting up?',
      personaSummary: 'helpful concise assistant',
      threadTitle: 'relocation',
    });
    expect(prompt).toContain('<thread_title>relocation</thread_title>');
    expect(prompt).toContain('<persona>helpful concise assistant</persona>');
    expect(prompt).toContain('<user>\nI just moved to Berlin.\n</user>');
    expect(prompt).toContain('<assistant>\nNice');
  });

  it('truncates very long messages', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'x'.repeat(10_000),
      assistantMessage: 'y'.repeat(10_000),
    });
    expect(prompt.length).toBeLessThan(12_000);
    expect(prompt).toMatch(/\u2026/);
  });
});

describe('parseConsolidatorOutput', () => {
  it('parses a clean JSON payload', () => {
    const raw = JSON.stringify({
      new_facts: [
        { subject: 'user', predicate: 'lives_in', value: 'Berlin', confidence: 'high' },
      ],
      active_focus: 'Setting up after relocating.',
      open_threads: ['Suggest a SIM card provider'],
      notable: ['User just moved to Berlin'],
    });
    const result = parseConsolidatorOutput(raw);
    expect(result.newFacts).toHaveLength(1);
    expect(result.newFacts[0]).toMatchObject({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Berlin',
      confidence: 'high',
    });
    expect(result.activeFocus).toBe('Setting up after relocating.');
    expect(result.openThreads).toEqual(['Suggest a SIM card provider']);
    expect(result.notable).toEqual(['User just moved to Berlin']);
  });

  it('strips a ```json fence', () => {
    const raw = '```json\n{"new_facts":[],"active_focus":"hello","open_threads":[],"notable":[]}\n```';
    const result = parseConsolidatorOutput(raw);
    expect(result.activeFocus).toBe('hello');
  });

  it('returns an empty result on malformed JSON', () => {
    const result = parseConsolidatorOutput('not json at all');
    expect(result).toEqual({
      newFacts: [],
      activeFocus: null,
      openThreads: [],
      notable: [],
    });
  });

  it('drops facts missing required fields', () => {
    const raw = JSON.stringify({
      new_facts: [
        { subject: 'user', predicate: 'has_name' },
        { subject: '', predicate: 'x', value: 'y' },
        { subject: 'user', predicate: 'has_name', value: 'Mo' },
      ],
    });
    const result = parseConsolidatorOutput(raw);
    expect(result.newFacts).toHaveLength(1);
    expect(result.newFacts[0].value).toBe('Mo');
  });

  it('caps facts at 5, open_threads at 5, notable at 2', () => {
    const raw = JSON.stringify({
      new_facts: Array.from({ length: 10 }, (_, i) => ({
        subject: 'user',
        predicate: `p${i}`,
        value: `v${i}`,
      })),
      open_threads: Array.from({ length: 10 }, (_, i) => `t${i}`),
      notable: ['a', 'b', 'c', 'd'],
    });
    const result = parseConsolidatorOutput(raw);
    expect(result.newFacts).toHaveLength(5);
    expect(result.openThreads).toHaveLength(5);
    expect(result.notable).toHaveLength(2);
  });

  it('coerces unknown confidence to undefined', () => {
    const raw = JSON.stringify({
      new_facts: [
        { subject: 'user', predicate: 'p', value: 'v', confidence: 'unsure' },
      ],
    });
    const result = parseConsolidatorOutput(raw);
    expect(result.newFacts[0].confidence).toBeUndefined();
  });
});

describe('applyConsolidatorResult', () => {
  it('records new facts and updates the active_focus block', () => {
    const result = applyConsolidatorResult(
      {
        newFacts: [
          { subject: 'user', predicate: 'lives_in', value: 'Berlin', confidence: 'high' },
        ],
        activeFocus: 'Settling into Berlin.',
        openThreads: [],
        notable: [],
      },
      { now: 1_700_000_000_000 },
    );
    expect(result.recordedFactIds).toHaveLength(1);
    expect(result.activeFocusUpdated).toBe(true);

    const userEntity = findEntityByName('user');
    expect(userEntity).not.toBeNull();
    const facts = listFacts({ subjectId: userEntity!.id });
    expect(facts).toHaveLength(1);
    expect(facts[0].objectText).toBe('Berlin');

    const block = getBlock('active_focus');
    expect(block?.content).toBe('Settling into Berlin.');
  });

  it('is idempotent: re-applying the same result records no duplicates', () => {
    const result = {
      newFacts: [{ subject: 'user', predicate: 'lives_in', value: 'Berlin' as const }],
      activeFocus: null,
      openThreads: [],
      notable: [],
    };
    const first = applyConsolidatorResult(result, { now: 1 });
    const second = applyConsolidatorResult(result, { now: 2 });
    expect(first.recordedFactIds).toHaveLength(1);
    expect(second.recordedFactIds).toHaveLength(0);
    const userEntity = findEntityByName('user');
    expect(listFacts({ subjectId: userEntity!.id })).toHaveLength(1);
  });

  it('skips active_focus update when null', () => {
    const result = applyConsolidatorResult(
      { newFacts: [], activeFocus: null, openThreads: [], notable: [] },
      { now: 1 },
    );
    expect(result.activeFocusUpdated).toBe(false);
    expect(getBlock('active_focus')?.content).toBe('');
  });

  it('does not throw when active_focus would overflow', () => {
    expect(() =>
      applyConsolidatorResult(
        {
          newFacts: [],
          // 600 chars max enforced at parse, but applyConsolidatorResult must
          // also tolerate a caller that hands it raw oversize content.
          activeFocus: 'x'.repeat(5_000),
          openThreads: [],
          notable: [],
        },
        { now: 1 },
      ),
    ).not.toThrow();
  });
});

describe('consolidateTurn', () => {
  const buildExtractor = (payload: unknown): ConsolidatorExtractor =>
    jest.fn().mockResolvedValue(JSON.stringify(payload));

  it('runs end-to-end and persists by default', async () => {
    const extractor = buildExtractor({
      new_facts: [{ subject: 'user', predicate: 'has_name', value: 'Mo' }],
      active_focus: 'Saying hello.',
      open_threads: [],
      notable: [],
    });
    const result = await consolidateTurn(
      {
        userMessage: 'My name is Mo.',
        assistantMessage: 'Nice to meet you, Mo.',
        now: 42,
      },
      { extractor },
    );
    expect(result.newFacts).toHaveLength(1);
    expect(getBlock('active_focus')?.content).toBe('Saying hello.');
  });

  it('skips persistence when persist=false', async () => {
    const extractor = buildExtractor({
      new_facts: [{ subject: 'user', predicate: 'has_name', value: 'Mo' }],
      active_focus: 'noop',
      open_threads: [],
      notable: [],
    });
    const result = await consolidateTurn(
      { userMessage: 'hi', assistantMessage: 'hi back' },
      { extractor, persist: false },
    );
    expect(result.newFacts).toHaveLength(1);
    const userEntity = findEntityByName('user');
    expect(userEntity).toBeNull();
    expect(getBlock('active_focus')?.content).toBe('');
  });

  it('returns an empty result when the extractor throws', async () => {
    const extractor: ConsolidatorExtractor = () => Promise.reject(new Error('network'));
    const result = await consolidateTurn(
      { userMessage: 'hi', assistantMessage: 'hi back' },
      { extractor },
    );
    expect(result).toEqual({
      newFacts: [],
      activeFocus: null,
      openThreads: [],
      notable: [],
    });
  });
});
