import { runMemoryTransaction } from '../../src/services/memory/access/transaction';
import { getMemoryDb } from '../../src/services/memory/database';
import type { MemoryFactContributionSourceAlias } from '../../src/services/memory/factContributionCodec';
import type { MemoryFactContributionWriteContext } from '../../src/services/memory/factContributionStore';
import { recordFactWithContribution } from '../../src/services/memory/facts/mutations';
import type { RecordFactInput, RecordFactResult } from '../../src/services/memory/facts/types';
import type {
  EpisodeSensitivitySourceMessage,
  RecordEpisodeInput,
} from '../../src/services/memory/episodes/types';
import type {
  MemoryFactSensitivity,
  SealedFactApplicabilityProvenance,
} from '../../src/services/memory/facts/applicabilityProvenance';
import type {
  MemorySensitivityDeclarationV1,
  MemorySensitivityInput,
} from '../../src/services/memory/memorySensitivityPolicy';
import type { VerifiedSourceRetirementOperation } from '../../src/services/memory/sourceRetirementOperationCodec';
import { loadVerifiedSourceRetirementOperationInTransaction } from '../../src/services/memory/sourceRetirementStore';

const GROUNDED_USER_APPLICABILITY = {
  factClass: 'subjective_user',
  sourceAuthority: 'grounded_user',
} as const;

export const CODE_OWNED_NORMAL_TEST_SENSITIVITY: MemorySensitivityDeclarationV1 = Object.freeze({
  version: 1,
  source: 'code_owned',
  sensitivity: 'normal',
});

export function codeOwnedClosedTurnEpisodeFields(params: {
  sourceUserMessageId: string;
  sourceAssistantMessageId: string;
  userContent?: string;
  assistantContent?: string;
  intermediateMessages?: ReadonlyArray<EpisodeSensitivitySourceMessage>;
  facts?: ReadonlyArray<MemorySensitivityInput>;
  declaredSensitivity?: MemoryFactSensitivity;
}): Pick<
  RecordEpisodeInput,
  'messageIds' | 'sourceStartMessageId' | 'sourceEndMessageId' | 'sensitivityEvidence'
> {
  const sourceMessages: EpisodeSensitivitySourceMessage[] = [
    {
      id: params.sourceUserMessageId,
      role: 'user',
      content: params.userContent ?? 'test user source',
    },
    ...(params.intermediateMessages ?? []),
    {
      id: params.sourceAssistantMessageId,
      role: 'assistant',
      content: params.assistantContent ?? 'test assistant source',
    },
  ];
  return {
    messageIds: sourceMessages.map((message) => message.id),
    sourceStartMessageId: params.sourceUserMessageId,
    sourceEndMessageId: params.sourceAssistantMessageId,
    sensitivityEvidence: {
      declaredSensitivity:
        params.declaredSensitivity ?? CODE_OWNED_NORMAL_TEST_SENSITIVITY.sensitivity,
      sourceMessages,
      facts: params.facts ?? [],
    },
  };
}

export interface ContributionBackedFactContext {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId?: string | null;
  producerEventId: string;
  producerId?: string;
  sourceAliases?: ReadonlyArray<MemoryFactContributionSourceAlias>;
  applicability?: SealedFactApplicabilityProvenance;
  sensitivityDeclaration: MemorySensitivityDeclarationV1;
}

export interface RetirementLedgerCounts {
  groups: number;
  requests: number;
  sources: number;
  contributions: number;
  facts: number;
}

function exactSourceAliases(input: RecordFactInput): MemoryFactContributionSourceAlias[] {
  const aliases: MemoryFactContributionSourceAlias[] = [];
  if (input.sourceMessageId) {
    aliases.push({ sourceKind: 'message', sourceId: input.sourceMessageId });
  }
  if (input.sourceTurnId) {
    aliases.push({ sourceKind: 'turn', sourceId: input.sourceTurnId });
  }
  if (input.sourceRunId) {
    aliases.push({ sourceKind: 'run', sourceId: input.sourceRunId });
  }
  return aliases;
}

export function recordContributionBackedFact(
  input: RecordFactInput,
  context: ContributionBackedFactContext,
): RecordFactResult {
  const sourceAliases = context.sourceAliases ?? exactSourceAliases(input);
  if (sourceAliases.length === 0) {
    throw new Error('retirement_test_fixture_source_alias_missing');
  }
  const writeContext: MemoryFactContributionWriteContext = {
    memoryConversationId: context.memoryConversationId,
    sourceThreadId: context.sourceThreadId,
    taskId: context.taskId,
    producer: {
      producerId: context.producerId ?? 'memory_retirement_test_fixture',
      producerEventId: context.producerEventId,
    },
    sourceAliases,
  };
  return recordFactWithContribution(
    input,
    context.applicability ?? GROUNDED_USER_APPLICABILITY,
    writeContext,
    context.sensitivityDeclaration,
  );
}

export function loadVerifiedFactRetirement(
  factId: string,
): VerifiedSourceRetirementOperation | null {
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    const row = db.getFirstSync<{ retirement_group_id: string }>(
      'SELECT retirement_group_id FROM memory_retired_facts WHERE fact_id = ? LIMIT 1',
      factId,
    );
    return row
      ? loadVerifiedSourceRetirementOperationInTransaction(db, row.retirement_group_id)
      : null;
  });
}

export function loadVerifiedRetirementGroup(
  retirementGroupId: string,
): VerifiedSourceRetirementOperation | null {
  return runMemoryTransaction(() =>
    loadVerifiedSourceRetirementOperationInTransaction(getMemoryDb(), retirementGroupId),
  );
}

export function retirementLedgerCounts(): RetirementLedgerCounts {
  const db = getMemoryDb();
  return {
    groups:
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_source_retirement_groups',
      )?.count ?? 0,
    requests:
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_source_retirement_requests',
      )?.count ?? 0,
    sources:
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_retired_sources')
        ?.count ?? 0,
    contributions:
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_retired_fact_contributions',
      )?.count ?? 0,
    facts:
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_retired_facts')
        ?.count ?? 0,
  };
}
