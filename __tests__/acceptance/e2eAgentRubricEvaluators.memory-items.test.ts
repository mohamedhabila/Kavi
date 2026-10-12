jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { captureForegroundScenarioMemoryItems } from '../../src/acceptance/e2eAgent/foregroundScenarioMemoryItemsEvidence';
import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import { resetE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import type { E2ERubric } from '../../src/acceptance/e2eAgent/types';
import { executeMemoryRemember } from '../../src/services/memory/core/memoryItemsTools';
import { indexMemoryTurn } from '../../src/services/memory/core/memoryTurnsStore';
import { buildE2ERubricResult } from '../helpers/e2eRubricResult';

function remember(content: string, extra: Record<string, unknown> = {}): string {
  const outcome = executeMemoryRemember(
    { content, ...extra },
    {
      conversationId: 'conv-memory',
      sourceMessageId: 'user-1',
      inRequestUserMessageIds: [],
      now: 1_000,
    },
  );
  return JSON.parse(outcome.content).memory.id as string;
}

function passes(rubric: E2ERubric): boolean {
  return evaluateE2ERubric(
    buildE2ERubricResult({ memoryItems: captureForegroundScenarioMemoryItems(2_000) }),
    rubric,
  ).passed;
}

beforeEach(() => {
  resetE2EMemorySandbox();
});

describe('memory item rubrics', () => {
  it('finds a current memory by the tokens it contains, ignoring case', () => {
    remember('Subject e2e-entity-i1 has artifact_token E2E-MEM-42');

    expect(passes({ kind: 'memory_item', contains: ['E2E-ENTITY-I1', 'e2e-mem-42'] })).toBe(true);
    expect(passes({ kind: 'memory_item', contains: ['e2e-entity-i1', 'E2E-MEM-43'] })).toBe(false);
  });

  it('checks the scope only when the rubric names one', () => {
    remember('The plan draft is notes/PLAN-E2E.md', { scope: 'conversation' });

    expect(passes({ kind: 'memory_item', contains: ['PLAN-E2E'] })).toBe(true);
    expect(passes({ kind: 'memory_item', contains: ['PLAN-E2E'], scope: 'conversation' })).toBe(
      true,
    );
    expect(passes({ kind: 'memory_item', contains: ['PLAN-E2E'], scope: 'global' })).toBe(false);
  });

  it('does not count a memory a correction replaced', () => {
    const old = remember('profile-owner home_city is Rotterdam');
    remember('profile-owner home_city is Utrecht', { replaces: old });

    expect(passes({ kind: 'memory_item_absent', contains: ['profile-owner', 'Rotterdam'] })).toBe(
      true,
    );
    expect(passes({ kind: 'memory_item', contains: ['profile-owner', 'Utrecht'] })).toBe(true);
  });

  it('tells a stale value from a correction that mentions it', () => {
    remember('profile-owner home_city is now Utrecht, not Rotterdam');

    const stale = { contains: ['profile-owner', 'Rotterdam'], excludes: ['Utrecht'] };
    expect(passes({ kind: 'memory_item_absent', ...stale })).toBe(true);
    expect(passes({ kind: 'memory_item', ...stale })).toBe(false);
  });

  it('rejects a malformed expectation instead of passing it', () => {
    remember('anything');

    expect(passes({ kind: 'memory_item_absent', contains: [] })).toBe(false);
    expect(passes({ kind: 'memory_item_absent', contains: [' padded '] })).toBe(false);
  });
});

describe('past-turn index rubric', () => {
  it('counts the closed turns the past-turn index holds', () => {
    expect(passes({ kind: 'memory_turns_indexed', min: 1 })).toBe(false);

    indexMemoryTurn({
      conversationId: 'conv-memory',
      userMessageId: 'user-1',
      userText: 'Book the kayak',
      replyText: 'Booked.',
      at: 1,
    });

    expect(passes({ kind: 'memory_turns_indexed', min: 1 })).toBe(true);
    expect(passes({ kind: 'memory_turns_indexed', min: 2 })).toBe(false);
  });
});
