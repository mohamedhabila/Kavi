// ---------------------------------------------------------------------------
// Tests — Memory consolidator (single-pass extractor + persistence)
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../src/services/memory/sqlite-store';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { ensureDefaultBlocks, getBlock } from '../../src/services/memory/blocks';
import { editWorkingBlock, getWorkingBlock } from '../../src/services/memory/workingBlocks';
import { listFacts } from '../../src/services/memory/facts/queries';
import { findEntityByName } from '../../src/services/memory/entities';
import { listEpisodes, listFactEvidence } from '../../src/services/memory/episodes/queries';
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

  it('prefers enriched user content in message windows', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'ignored',
      assistantMessage: 'ignored',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'raw user text',
          enrichedContent: 'enriched user text with context',
          timestamp: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'assistant reply',
          timestamp: 2,
        },
      ],
    });

    expect(prompt).toContain('enriched user text with context');
    expect(prompt).not.toContain('raw user text');
    expect(prompt).toContain('assistant reply');
  });

  it('limits provider extraction prompts to the closed turn window when source ids are supplied', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'ignored',
      assistantMessage: 'ignored',
      sourceUserMessageId: 'u2',
      sourceAssistantMessageId: 'a2',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'older preference Morgan',
          timestamp: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'older acknowledgement',
          timestamp: 2,
        },
        {
          id: 'u2',
          role: 'user',
          content: 'updated preference Avery',
          timestamp: 3,
        },
        {
          id: 'a2',
          role: 'assistant',
          content: 'updated acknowledgement',
          timestamp: 4,
        },
      ],
    });

    expect(prompt).toContain('updated preference Avery');
    expect(prompt).toContain('updated acknowledgement');
    expect(prompt).not.toContain('older preference Morgan');
    expect(prompt).not.toContain('older acknowledgement');
  });

  it('summarizes tool results instead of exposing raw recalled memory payloads', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'ignored',
      assistantMessage: 'ignored',
      sourceUserMessageId: 'u1',
      sourceAssistantMessageId: 'a2',
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Verify current city.',
          timestamp: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-recall',
              name: 'memory_recall',
              arguments: '{"subject":"locomo-user","includeHistory":true}',
              status: 'completed',
            },
          ],
          assistantMetadata: {
            finishReason: 'stop',
            kind: 'final',
            completionStatus: 'complete',
          },
        },
        {
          id: 't1',
          role: 'tool',
          toolCallId: 'tc-recall',
          toolCalls: [
            {
              id: 'tc-recall',
              name: 'memory_recall',
              arguments: '{}',
              status: 'completed',
            },
          ],
          content:
            '{"ok":true,"facts":[{"predicate":"primary_city","value":"AMSTERDAM-E2E","invalidAt":10},{"predicate":"primary_city","value":"ROTTERDAM-E2E","invalidAt":null}]}',
          timestamp: 3,
        },
        {
          id: 'a2',
          role: 'assistant',
          content: 'Verified and wrote the summary.',
          timestamp: 4,
          assistantMetadata: {
            finishReason: 'stop',
            kind: 'final',
            completionStatus: 'complete',
          },
        },
      ],
    });

    expect(prompt).toContain('tools=memory_recall');
    expect(prompt).toContain('[tool_result name=memory_recall status=completed]');
    expect(prompt).not.toContain('AMSTERDAM-E2E');
    expect(prompt).not.toContain('ROTTERDAM-E2E');
    expect(prompt).not.toContain('primary_city');
  });

  it('instructs the extractor to retain explicit scoped memory writes', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'Remember this task-local verification token.',
      assistantMessage: 'Done.',
    });

    expect(prompt).toContain('Memory is');
    expect(prompt).toContain('active-task facts');
    expect(prompt).toContain('Extract explicit user memory-write intents in any language');
    expect(prompt).toContain('Preserve supplied');
    expect(prompt).toContain('checksums, codes, and tokens');
  });
});

describe('parseConsolidatorOutput', () => {
  it('parses a clean JSON payload', () => {
    const raw = JSON.stringify({
      new_facts: [{ subject: 'user', predicate: 'lives_in', value: 'Berlin', confidence: 'high' }],
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
    const raw =
      '```json\n{"new_facts":[],"active_focus":"hello","open_threads":[],"notable":[]}\n```';
    const result = parseConsolidatorOutput(raw);
    expect(result.activeFocus).toBe('hello');
  });

  it('returns an empty result on malformed JSON', () => {
    const result = parseConsolidatorOutput('not json at all');
    expect(result).toEqual({
      episodeSummary: null,
      newFacts: [],
      invalidatedFacts: [],
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
      new_facts: [{ subject: 'user', predicate: 'p', value: 'v', confidence: 'unsure' }],
    });
    const result = parseConsolidatorOutput(raw);
    expect(result.newFacts[0].confidence).toBeUndefined();
  });
});

describe('applyConsolidatorResult', () => {
  it('records new facts and updates the active_focus block', () => {
    const result = applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [
          {
            subject: 'user',
            predicate: 'lives_in',
            value: 'Berlin',
            confidence: 'high',
            scope: 'global',
            importance: 0.8,
            evidenceMessageIds: ['u-1'],
            reason: 'The user stated this directly.',
          },
        ],
        invalidatedFacts: [],
        activeFocus: 'Settling into Berlin.',
        openThreads: ['Suggest a SIM card provider'],
        notable: [],
      },
      {
        now: 1_700_000_000_000,
        conversationId: 'conv-1',
        threadId: 'conv-1',
        sourceUserMessageId: 'u-1',
        sourceAssistantMessageId: 'a-1',
      },
    );
    expect(result.recordedFactIds).toHaveLength(1);
    expect(result.activeFocusUpdated).toBe(true);
    expect(result.openThreadsUpdated).toBe(true);

    const userEntity = findEntityByName('user');
    expect(userEntity).not.toBeNull();
    const facts = listFacts({ subjectId: userEntity!.id });
    expect(facts).toHaveLength(1);
    expect(facts[0].objectText).toBe('Berlin');
    expect(facts[0].scope).toBe('global');
    expect(facts[0].originConversationId).toBe('conv-1');
    expect(facts[0].importance).toBe(0.8);
    expect(listFactEvidence(facts[0].id)).toHaveLength(1);

    expect(getBlock('active_focus')?.content).toBe('');
    const focusBlock = getWorkingBlock('active_focus', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
    });
    expect(focusBlock?.content).toBe('Settling into Berlin.');
    expect(
      getWorkingBlock('open_threads', {
        conversationId: 'conv-1',
        threadId: 'conv-1',
      })?.content,
    ).toContain('Suggest a SIM card provider');
  });

  it('ignores automatic invalidation payloads and keeps existing facts current', () => {
    applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [
          {
            subject: 'user',
            predicate: 'preferred_message_contact',
            value: 'Morgan',
            confidence: 'high',
          },
        ],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      { now: 1_700_000_000_000, conversationId: 'conv-memory', threadId: 'conv-memory' },
    );

    const result = applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [],
        invalidatedFacts: [
          {
            subject: 'user',
            predicate: 'preferred_message_contact',
            reason: 'provider guessed this changed',
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      { now: 1_700_000_001_000, conversationId: 'conv-memory', threadId: 'conv-memory' },
    );

    const userEntity = findEntityByName('user');
    expect(userEntity).not.toBeNull();
    expect(result.invalidatedFactIds).toEqual([]);
    const currentFacts = listFacts({
      subjectId: userEntity!.id,
      predicate: 'preferred_message_contact',
    });
    expect(currentFacts).toHaveLength(1);
    expect(currentFacts[0].objectText).toBe('Morgan');
  });

  it('preserves thread title metadata when provider focus omits it', () => {
    const result = applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [],
        invalidatedFacts: [],
        activeFocus: 'Running: memory_recall',
        openThreads: [],
        notable: [],
      },
      {
        now: 1_700_000_000_001,
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
        threadTitle: 'longmem-delayed-thread',
      },
    );

    expect(result.activeFocusUpdated).toBe(true);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
      })?.content,
    ).toBe('longmem-delayed-thread\nRunning: memory_recall');
  });

  it('skips active_focus writes when taskId is set (graph-owned task focus)', () => {
    editWorkingBlock('active_focus', 'scope-b-planning', {
      conversationId: 'conv-task',
      threadId: 'conv-task',
      taskId: 'scope-b',
    });

    const result = applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [],
        invalidatedFacts: [],
        activeFocus: 'Running: update_goals',
        openThreads: [],
        notable: [],
      },
      {
        now: 3,
        conversationId: 'conv-task',
        threadId: 'conv-task',
        taskId: 'scope-b',
      },
    );

    expect(result.activeFocusUpdated).toBe(false);
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'conv-task',
        threadId: 'conv-task',
        taskId: 'scope-b',
      })?.content,
    ).toBe('scope-b-planning');
  });

  it('supersedes stale conversation facts across task scopes', () => {
    applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [
          {
            subject: 'direct-longmem-user',
            predicate: 'preferred_message_contact',
            value: 'Morgan',
            scope: 'conversation',
          },
        ],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 10,
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
        taskId: 'memory-goal-a',
        sourceUserMessageId: 'u-1',
        sourceAssistantMessageId: 'a-1',
      },
    );
    applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [
          {
            subject: 'direct-longmem-user',
            predicate: 'preferred_message_contact',
            value: 'Avery',
            scope: 'conversation',
          },
        ],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 20,
        conversationId: 'conv-longmem',
        threadId: 'conv-longmem',
        taskId: 'memory-goal-b',
        sourceUserMessageId: 'u-2',
        sourceAssistantMessageId: 'a-2',
      },
    );

    const subject = findEntityByName('direct-longmem-user');
    expect(subject).not.toBeNull();
    const currentFacts = listFacts({
      subjectId: subject!.id,
      predicate: 'preferred_message_contact',
      includeInvalidated: false,
    });
    expect(currentFacts.map((fact) => fact.objectText)).toEqual(['Avery']);

    const historicalFacts = listFacts({
      subjectId: subject!.id,
      predicate: 'preferred_message_contact',
      includeInvalidated: true,
    });
    expect(historicalFacts.map((fact) => fact.objectText).sort()).toEqual(['Avery', 'Morgan']);
    expect(historicalFacts.find((fact) => fact.objectText === 'Morgan')?.invalidAt).toBe(20);
  });

  it('clears scoped open_threads when the consolidator returns an empty list', () => {
    applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: ['Old follow-up'],
        notable: [],
      },
      { now: 1, conversationId: 'conv-clear', threadId: 'conv-clear' },
    );

    const result = applyConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      { now: 2, conversationId: 'conv-clear', threadId: 'conv-clear' },
    );

    expect(result.openThreadsUpdated).toBe(true);
    expect(
      getWorkingBlock('open_threads', {
        conversationId: 'conv-clear',
        threadId: 'conv-clear',
      })?.content,
    ).toBe('');
  });

  it('persists episode summaries as searchable episodic memory', () => {
    const result = applyConsolidatorResult(
      {
        episodeSummary: 'The user compared local model runtime options.',
        newFacts: [],
        invalidatedFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        now: 10_000,
        conversationId: 'conv-episode',
        messages: [
          { id: 'u-episode', role: 'user', content: 'Compare runtimes', timestamp: 9_000 },
          { id: 'a-episode', role: 'assistant', content: 'Done', timestamp: 10_000 },
        ] as any,
      },
    );

    expect(result.episodeId).toEqual(expect.any(String));
    expect(listEpisodes({ conversationId: 'conv-episode' })[0]?.summary).toContain(
      'runtime options',
    );
  });

  it('is idempotent: re-applying the same result records no duplicates', () => {
    const result = {
      episodeSummary: null,
      newFacts: [{ subject: 'user', predicate: 'lives_in', value: 'Berlin' as const }],
      invalidatedFacts: [],
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
          episodeSummary: null,
          newFacts: [],
          invalidatedFacts: [],
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
      episodeSummary: null,
      newFacts: [],
      invalidatedFacts: [],
      activeFocus: null,
      openThreads: [],
      notable: [],
    });
  });
});
