import { getMemoryDb } from '../../src/services/memory/database';
import { upsertEntity } from '../../src/services/memory/entities';
import {
  addFactEvidence,
  recordThreadLocalEpisode,
} from '../../src/services/memory/episodes/mutations';
import { recordFactWithApplicability } from '../../src/services/memory/facts/mutations';
import { getLocalMemoryVaultOwnerId } from '../../src/services/memory/memoryVaultIdentity';
import { retireExactMemorySources } from '../../src/services/memory/sourceRetirementCoordinator';
import { codeOwnedClosedTurnEpisodeFields } from './memoryRetirementTestFixtures';

export function reopenLegacyBoundary(): void {
  getMemoryDb().execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_insert_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_delete_immutable;
    DELETE FROM memory_fact_contribution_admission;
  `);
}

export function exactConversationLegacyFact(predicate: string) {
  const subject = upsertEntity({ name: 'user', type: 'self', now: 100 });
  const fact = recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate,
      objectText: 'legacy value',
      scope: 'conversation',
      originConversationId: 'legacy-conversation',
      originThreadId: 'legacy-thread',
      sourceMessageId: `${predicate}-message`,
      sourceTurnId: `${predicate}-turn`,
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
  const messageId = `${predicate}-message`;
  const turnId = `${predicate}-turn`;
  const episode = recordThreadLocalEpisode({
    conversationId: 'legacy-conversation',
    threadId: 'legacy-thread',
    taskId: null,
    summary: 'Exact legacy evidence.',
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: messageId,
      sourceAssistantMessageId: turnId,
      userContent: 'Exact legacy evidence.',
      assistantContent: 'Exact legacy evidence.',
    }),
    now: 101,
  });
  addFactEvidence({
    factId: fact.id,
    episodeId: episode!.id,
    messageId,
    role: 'user',
    quote: 'Exact legacy evidence.',
    now: 101,
  });
  return fact;
}

export function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

export function retireLegacyMessageSource(
  sourceId: string,
  retiredAt: number,
  retirementGroupId: string,
) {
  const db = getMemoryDb();
  return retireExactMemorySources({
    reason: 'message_delete',
    requestedSources: [
      {
        memoryOwnerId: getLocalMemoryVaultOwnerId(db),
        memoryConversationId: 'legacy-conversation',
        sourceThreadId: 'legacy-thread',
        taskId: '',
        sourceKind: 'message',
        sourceId,
      },
    ],
    retiredAt,
    retirementGroupId,
  });
}
