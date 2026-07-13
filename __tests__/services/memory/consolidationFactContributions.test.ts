jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { insertRetiredMemorySourceForTest } from '../../helpers/memoryWithdrawalFixtures';
import { applyThreadLocalConsolidatorResult } from '../../../src/services/memory/consolidator';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  CONSOLIDATION_FACT_PRODUCER_IDS,
  buildConsolidationFactProducerEventId,
} from '../../../src/services/memory/consolidation/factContributionIdentity';
import { listFacts } from '../../../src/services/memory/facts/queries';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  isMemorySourceWithdrawn,
  MemoryPersistenceSourceWithdrawnError,
} from '../../../src/services/memory/withdrawalFence';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

interface ContributionRow {
  id: string;
  fact_id: string;
  predicate: string;
  producer_id: string;
  producer_event_id: string;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => closeMemoryDb());

function contributionRows(): ContributionRow[] {
  return getMemoryDb().getAllSync<ContributionRow>(
    `SELECT contribution.id, contribution.fact_id, fact.predicate,
            contribution.producer_id, contribution.producer_event_id
       FROM memory_fact_contributions contribution
       JOIN memory_facts fact ON fact.id = contribution.fact_id
      ORDER BY fact.predicate ASC`,
  );
}

function sourceAliases(contributionId: string) {
  return getMemoryDb().getAllSync<{ source_kind: string; source_id: string }>(
    `SELECT source_kind, source_id
       FROM memory_fact_contribution_sources
      WHERE contribution_id = ?
      ORDER BY source_kind ASC, source_id ASC`,
    contributionId,
  );
}

function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

describe('consolidation fact contributions', () => {
  it('uses stable per-fact events and exact per-fact aliases across replay', () => {
    const result = {
      episodeSummary: null,
      newFacts: [
        {
          subject: 'user',
          predicate: 'favorite_drink',
          value: 'tea',
          evidenceMessageIds: ['evidence-drink'],
        },
        {
          subject: 'user',
          predicate: 'favorite_food',
          value: 'ramen',
          evidenceMessageIds: ['evidence-food'],
        },
      ],
      activeFocus: null,
      openThreads: [],
      notable: [],
    };
    const options = {
      conversationId: 'contribution-conversation',
      threadId: 'contribution-thread',
      sourceUserMessageId: 'source-user',
      sourceAssistantMessageId: 'source-assistant',
      sourceRunId: 'source-run',
      factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
      skipWorkingMemoryWrites: true,
      now: 100,
    } as const;

    const first = applyThreadLocalConsolidatorResult(result, options);
    const replay = applyThreadLocalConsolidatorResult(result, options);
    expect(first.recordedFacts).toHaveLength(2);
    expect(replay.recordedFacts).toHaveLength(0);

    const contributions = contributionRows();
    expect(contributions).toHaveLength(2);
    expect(new Set(contributions.map((row) => row.producer_event_id)).size).toBe(2);
    expect(contributions.map((row) => row.producer_event_id).sort()).toEqual(
      [0, 1]
        .map((inputIndex) =>
          buildConsolidationFactProducerEventId({
            producerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
            sourceAssistantMessageId: options.sourceAssistantMessageId,
            inputIndex,
          }),
        )
        .sort(),
    );

    const drink = contributions.find((row) => row.predicate === 'favorite_drink')!;
    const food = contributions.find((row) => row.predicate === 'favorite_food')!;
    expect(sourceAliases(drink.id)).toEqual([
      { source_kind: 'message', source_id: 'evidence-drink' },
      { source_kind: 'message', source_id: 'source-user' },
      { source_kind: 'run', source_id: 'source-run' },
      { source_kind: 'turn', source_id: 'source-assistant' },
    ]);
    expect(sourceAliases(food.id)).toEqual([
      { source_kind: 'message', source_id: 'evidence-food' },
      { source_kind: 'message', source_id: 'source-user' },
      { source_kind: 'run', source_id: 'source-run' },
      { source_kind: 'turn', source_id: 'source-assistant' },
    ]);

    expect(() =>
      applyThreadLocalConsolidatorResult(
        {
          ...result,
          newFacts: [result.newFacts[0]!, { ...result.newFacts[1]!, value: 'udon' }],
        },
        options,
      ),
    ).toThrow('memory_fact_contribution_replay_mismatch');
    expect(contributionRows()).toEqual(contributions);
    expect(
      listFacts({ originConversationId: options.conversationId }).map((fact) => fact.objectText),
    ).toEqual(expect.arrayContaining(['tea', 'ramen']));
    expect(
      listFacts({ originConversationId: options.conversationId }).map((fact) => fact.objectText),
    ).not.toContain('udon');
  });

  it('records the admitted correction and supersession edge in the same contribution', () => {
    const first = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [
          {
            subject: 'user',
            predicate: 'favorite_city',
            value: 'Amsterdam',
            scope: 'conversation',
            admittedWrite: {
              operation: 'insert',
              authority: 'grounded_user_statement',
              evidenceMessageId: 'user-city-old',
            },
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        conversationId: 'correction-conversation',
        threadId: 'correction-thread',
        sourceUserMessageId: 'user-city-old',
        sourceAssistantMessageId: 'assistant-city-old',
        factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.providerTurn,
        skipWorkingMemoryWrites: true,
        now: 100,
      },
    );
    const predecessorFactId = first.resolvedFacts[0]!.factId;

    const replacement = applyThreadLocalConsolidatorResult(
      {
        episodeSummary: null,
        newFacts: [
          {
            subject: 'user',
            predicate: 'favorite_city',
            value: 'Rotterdam',
            scope: 'conversation',
            admittedWrite: {
              operation: 'replace_current',
              authority: 'grounded_user_statement',
              evidenceMessageId: 'user-city-new',
              expectedCurrentFactId: predecessorFactId,
            },
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
      {
        conversationId: 'correction-conversation',
        threadId: 'correction-thread',
        sourceUserMessageId: 'user-city-new',
        sourceAssistantMessageId: 'assistant-city-new',
        factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.providerTurn,
        skipWorkingMemoryWrites: true,
        now: 200,
      },
    );
    const successorFactId = replacement.resolvedFacts[0]!.factId;

    expect(replacement.invalidatedFactIds).toEqual([predecessorFactId]);
    expect(
      getMemoryDb().getAllSync(
        `SELECT predecessor_fact_id, successor_fact_id, superseded_at
           FROM memory_fact_contribution_supersessions`,
      ),
    ).toEqual([
      {
        predecessor_fact_id: predecessorFactId,
        successor_fact_id: successorFactId,
        superseded_at: 200,
      },
    ]);
    expect(contributionRows()).toHaveLength(2);
  });

  it('rejects the fallback assistant-message alias and rolls back the consolidation', () => {
    const scope = {
      memoryConversationId: 'fallback-retirement-conversation',
      sourceThreadId: 'fallback-retirement-thread',
      taskId: null,
    };
    const sourceAssistantMessageId = 'fallback-retirement-assistant';
    insertRetiredMemorySourceForTest({
      retirementGroupId: 'fallback-message-retirement',
      ...scope,
      sourceKind: 'message',
      sourceId: sourceAssistantMessageId,
    });
    expect(
      isMemorySourceWithdrawn({
        ...scope,
        sourceKind: 'turn',
        sourceId: sourceAssistantMessageId,
      }),
    ).toBe(false);

    expect(() =>
      applyThreadLocalConsolidatorResult(
        {
          episodeSummary: 'The user selected English for future conversations.',
          newFacts: [
            {
              subject: 'user',
              predicate: 'preferred_language',
              value: 'English',
            },
          ],
          activeFocus: 'Use English in future conversations.',
          openThreads: ['Confirm regional spelling preference.'],
          notable: [],
        },
        {
          conversationId: scope.memoryConversationId,
          threadId: scope.sourceThreadId,
          sourceAssistantMessageId,
          factContributionProducerId: CONSOLIDATION_FACT_PRODUCER_IDS.threadLocalImport,
          now: 200,
        },
      ),
    ).toThrow(MemoryPersistenceSourceWithdrawnError);

    for (const table of [
      'memory_entities',
      'memory_episodes',
      'memory_facts',
      'memory_fact_terms',
      'memory_fact_evidence',
      'memory_fact_contributions',
      'memory_fact_contribution_sources',
      'memory_working_blocks',
    ]) {
      expect(tableCount(table)).toBe(0);
    }
  });
});
