import { runMemoryTransaction } from '../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/database';
import { upsertEntity } from '../../src/services/memory/entities';
import type { PersistedExactMemorySourceIdentity } from '../../src/services/memory/exactMemorySourceIdentity';
import { buildMemoryFactContributionId } from '../../src/services/memory/factContributionCodec';
import { recordFactWithContributionInTransaction } from '../../src/services/memory/facts/mutations';
import { replaceCurrentFactWithContribution } from '../../src/services/memory/facts/exactReplacement';
import type { MemoryFact, RecordFactInput } from '../../src/services/memory/facts/types';
import { getLocalMemoryVaultOwnerId } from '../../src/services/memory/memoryVaultIdentity';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

export const GROUNDED = {
  factClass: 'subjective_user',
  sourceAuthority: 'grounded_user',
} as const;

export interface SeededContribution {
  fact: MemoryFact;
  contributionId: string;
  messageSource: PersistedExactMemorySourceIdentity;
  turnSource: PersistedExactMemorySourceIdentity;
}

export function resetRetirementFixture(): void {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
}

export function closeRetirementFixture(): void {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
}

export function localOwnerId(): string {
  return getLocalMemoryVaultOwnerId(getMemoryDb());
}

export function exactSource(
  sourceKind: PersistedExactMemorySourceIdentity['sourceKind'],
  sourceId: string,
  overrides: Partial<PersistedExactMemorySourceIdentity> = {},
): PersistedExactMemorySourceIdentity {
  return {
    memoryOwnerId: localOwnerId(),
    memoryConversationId: 'conversation-retirement',
    sourceThreadId: 'thread-retirement',
    taskId: '',
    sourceKind,
    sourceId,
    ...overrides,
  };
}

function contributionInput(
  suffix: string,
  subjectId: string,
  overrides: Partial<RecordFactInput>,
): RecordFactInput {
  return {
    subjectId,
    predicate: '状态',
    objectText: 'القيمة الأصلية',
    attributes: { event: suffix },
    scope: 'global',
    sourceMessageId: `message-${suffix}`,
    sourceTurnId: `turn-${suffix}`,
    now: 100,
    ...overrides,
  };
}

function contributionContext(suffix: string) {
  return {
    memoryConversationId: 'conversation-retirement',
    sourceThreadId: 'thread-retirement',
    taskId: null,
    producer: {
      producerId: 'source_retirement_coordinator_test',
      producerEventId: `event-${suffix}`,
    },
    sourceAliases: [
      { sourceKind: 'message' as const, sourceId: `message-${suffix}` },
      { sourceKind: 'turn' as const, sourceId: `turn-${suffix}` },
    ],
  };
}

export function seedContribution(
  suffix: string,
  overrides: Partial<RecordFactInput> = {},
): SeededContribution {
  const subjectId =
    overrides.subjectId ?? upsertEntity({ name: `subject-${suffix}`, type: 'self', now: 1 }).id;
  const recorded = runMemoryTransaction(() =>
    recordFactWithContributionInTransaction(
      contributionInput(suffix, subjectId, overrides),
      GROUNDED,
      contributionContext(suffix),
    ),
  );
  return {
    fact: recorded.result.fact,
    contributionId: recorded.contributionId,
    messageSource: exactSource('message', `message-${suffix}`),
    turnSource: exactSource('turn', `turn-${suffix}`),
  };
}

export function seedSharedContribution(
  suffix: string,
  target: SeededContribution,
  overrides: Partial<RecordFactInput> = {},
): SeededContribution {
  return seedContribution(suffix, {
    subjectId: target.fact.subjectId,
    predicate: target.fact.predicate,
    objectText: target.fact.objectText,
    ...overrides,
  });
}

export function seedReplacement(
  suffix: string,
  predecessor: SeededContribution,
  overrides: Partial<RecordFactInput> = {},
): SeededContribution {
  const input = contributionInput(suffix, predecessor.fact.subjectId, {
    predicate: predecessor.fact.predicate,
    objectText: `replacement-${suffix}`,
    now: 200,
    ...overrides,
  });
  const context = contributionContext(suffix);
  const recorded = replaceCurrentFactWithContribution(
    { ...input, expectedCurrentFactId: predecessor.fact.id },
    GROUNDED,
    context,
  );
  if (recorded.status === 'conflict' || !recorded.fact) {
    throw new Error('source_retirement_replacement_fixture_conflict');
  }
  return {
    fact: recorded.fact,
    contributionId: buildMemoryFactContributionId({
      scope: {
        memoryOwnerId: localOwnerId(),
        memoryConversationId: context.memoryConversationId,
        sourceThreadId: context.sourceThreadId,
        taskId: '',
      },
      producer: context.producer,
    }),
    messageSource: exactSource('message', `message-${suffix}`),
    turnSource: exactSource('turn', `turn-${suffix}`),
  };
}

export function rowForFact(factId: string): Record<string, unknown> | null {
  return (
    getMemoryDb().getFirstSync<Record<string, unknown>>(
      'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
      factId,
    ) ?? null
  );
}

export function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}
