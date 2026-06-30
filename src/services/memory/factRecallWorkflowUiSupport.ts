import {
  listFactsForSourceRunForwardWindows,
  listFactTermUnitHitsForFacts,
  listFactsForSourceRunStateNeighborhoods,
} from './facts/queries';
import { listFactsForSourceRunLexicalMatches } from './facts/sourceRunLexicalMatches';
import type { MemoryFact, MemoryFactKind, MemoryFactScope } from './facts/types';
import {
  type RecallFactsOptions,
  type ScoredFact,
} from './factRecallTypes';
import { buildScoredFact } from './factRecallScoring';
import {
  isActionResultOutcome,
  rankWorkflowSupportEntries,
  selectedActionResultSourceRuns,
  sourceBalancedSupportEntries,
  supportQueryEvidenceScore,
} from './factRecallSupport';
import {
  sourceRunSupportContexts,
  sourceRunStateKey,
  supportDiversityKey,
} from './ranking/selection';

const SOURCE_RUN_SUPPORT_FORWARD_RADIUS = 16;
const SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT = 16;
const SOURCE_RUN_EXACT_STATE_PRECISE_SUPPORT_LIMIT = 12;
const SOURCE_RUN_SUPPORT_LEXICAL_PER_RUN_LIMIT = 6;
const SOURCE_RUN_SUPPORT_RADIUS = 2;
const SOURCE_RUN_SUPPORT_PER_RUN_LIMIT = 8;
const WORKFLOW_SUPPORT_ANCHOR_KINDS = new Set<MemoryFactKind>([
  'procedure',
  'ui_inventory',
  'ui_field',
  'ui_filter_state',
  'outcome',
]);

type AddSelectedSupportFact = (
  fact: MemoryFact,
  supportLimit: number,
  dedupeKey?: string | null,
) => boolean;

function canAnchorWorkflowSupport(fact: MemoryFact): boolean {
  return WORKFLOW_SUPPORT_ANCHOR_KINDS.has(fact.memoryKind);
}

function supportObservationContext(fact: MemoryFact): {
  sourceRunId: string | null;
  stateIndex: string | number | null;
} {
  const stateIndex = fact.attributes.stateIndex;
  return {
    sourceRunId: fact.sourceRunId,
    stateIndex:
      typeof stateIndex === 'string' || typeof stateIndex === 'number' ? stateIndex : null,
  };
}

export function insertWorkflowUiSupport(params: {
  selected: MemoryFact[];
  seenIds: ReadonlySet<string>;
  seenUiSupportDiversityKeys: Set<string>;
  seenUiSupportDiversitySourceKeys: Set<string>;
  scoredById: Map<string, ScoredFact>;
  scored: ReadonlyArray<ScoredFact>;
  limit: number;
  reservedSupportSlots: number;
  candidateScopes: MemoryFactScope[] | undefined;
  options: RecallFactsOptions;
  scoringQueryUnits: ReadonlySet<string>;
  recallLexicalUnits: ReadonlyArray<string>;
  unitWeights: ReadonlyMap<string, number>;
  query: string;
  anchorUnitSets: ReadonlyArray<Set<string>>;
  alwaysIncludePinned: boolean;
  now: number;
  addSelectedSupportFact: AddSelectedSupportFact;
}): void {
  if (!params.query || params.selected.length >= params.limit || params.reservedSupportSlots <= 0) {
    return;
  }
  const supportAnchors = params.selected.filter(canAnchorWorkflowSupport);
  const procedureSupportAnchors = supportAnchors.filter(
    (fact) => fact.memoryKind === 'procedure',
  );
  const orderedSupportAnchors = [
    ...procedureSupportAnchors,
    ...supportAnchors.filter((fact) => fact.memoryKind !== 'procedure'),
  ];
  const supportContexts = sourceRunSupportContexts(orderedSupportAnchors, params.scored);
  const exactSupportContextKeys = new Set(
    supportContexts.map((context) => `${context.sourceRunId}:${context.stateIndex}`),
  );
  const selectedSourceRuns = Array.from(
    new Set(orderedSupportAnchors.map((fact) => fact.sourceRunId).filter(Boolean) as string[]),
  );
  const supportLimit = Math.min(params.limit, params.selected.length + params.reservedSupportSlots);
  const supportFactsById = new Map<string, MemoryFact>();
  const commonQueryOptions = {
    ...(params.candidateScopes ? { scope: params.candidateScopes } : {}),
    ...(params.options.conversationId
      ? { originConversationId: params.options.conversationId }
      : {}),
    ...(params.options.taskId ? { originTaskId: params.options.taskId } : {}),
    ...(params.options.includeHistorical ? { includeInvalidated: true as const } : {}),
    ...(params.options.asOf !== undefined ? { asOf: params.options.asOf } : {}),
  };
  const forwardFacts = listFactsForSourceRunForwardWindows(supportContexts, {
    memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state'],
    forwardRadius: SOURCE_RUN_SUPPORT_FORWARD_RADIUS,
    stateLimit: SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
    limit: supportContexts.length * SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
    ...commonQueryOptions,
  });
  for (const fact of forwardFacts) {
    if (
      params.seenIds.has(fact.id) ||
      !fact.sourceRunId ||
      !selectedSourceRuns.includes(fact.sourceRunId)
    ) {
      continue;
    }
    supportFactsById.set(fact.id, fact);
  }
  const actionResultSupportContexts = sourceRunSupportContexts(
    supportAnchors.filter(isActionResultOutcome),
    params.scored,
  );
  if (actionResultSupportContexts.length > 0) {
    const forwardOutcomeFacts = listFactsForSourceRunForwardWindows(actionResultSupportContexts, {
      memoryKind: ['outcome'],
      forwardRadius: SOURCE_RUN_SUPPORT_FORWARD_RADIUS,
      stateLimit: SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      limit: actionResultSupportContexts.length * SOURCE_RUN_SUPPORT_FORWARD_STATE_LIMIT,
      ...commonQueryOptions,
    });
    for (const fact of forwardOutcomeFacts) {
      if (
        params.seenIds.has(fact.id) ||
        !fact.sourceRunId ||
        !selectedSourceRuns.includes(fact.sourceRunId)
      ) {
        continue;
      }
      supportFactsById.set(fact.id, fact);
    }
  }
  for (const sourceRunId of selectedSourceRuns) {
    const contextsForRun = supportContexts.filter(
      (context) => context.sourceRunId === sourceRunId,
    );
    if (contextsForRun.length === 0) continue;
    const supportFacts = listFactsForSourceRunStateNeighborhoods(contextsForRun, {
      memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state'],
      preferAdjacent: false,
      radius: SOURCE_RUN_SUPPORT_RADIUS,
      limit: contextsForRun.length * SOURCE_RUN_SUPPORT_PER_RUN_LIMIT,
      ...commonQueryOptions,
    });
    for (const fact of supportFacts) {
      if (params.seenIds.has(fact.id) || fact.sourceRunId !== sourceRunId) continue;
      supportFactsById.set(fact.id, fact);
    }
  }
  const lexicalSupportFacts = listFactsForSourceRunLexicalMatches(
    selectedSourceRuns,
    params.recallLexicalUnits,
    {
      memoryKind: ['ui_inventory', 'ui_field', 'ui_filter_state', 'outcome'],
      limit: selectedSourceRuns.length * SOURCE_RUN_SUPPORT_LEXICAL_PER_RUN_LIMIT,
      ...commonQueryOptions,
    },
  );
  for (const fact of lexicalSupportFacts) {
    if (
      params.seenIds.has(fact.id) ||
      !fact.sourceRunId ||
      !selectedSourceRuns.includes(fact.sourceRunId)
    ) {
      continue;
    }
    if (
      isActionResultOutcome(fact) &&
      selectedActionResultSourceRuns(params.selected).has(fact.sourceRunId)
    ) {
      continue;
    }
    supportFactsById.set(fact.id, fact);
  }
  const exactStatePreciseSupportFacts = listFactsForSourceRunStateNeighborhoods(
    Array.from(supportFactsById.values()).map(supportObservationContext),
    {
      memoryKind: ['ui_field', 'ui_filter_state'],
      preferAdjacent: false,
      radius: 0,
      limit: supportFactsById.size * SOURCE_RUN_EXACT_STATE_PRECISE_SUPPORT_LIMIT,
      ...commonQueryOptions,
    },
  );
  for (const fact of exactStatePreciseSupportFacts) {
    if (
      params.seenIds.has(fact.id) ||
      !fact.sourceRunId ||
      !selectedSourceRuns.includes(fact.sourceRunId)
    ) {
      continue;
    }
    supportFactsById.set(fact.id, fact);
  }
  const supportFacts = Array.from(supportFactsById.values());
  const supportUnitHits = listFactTermUnitHitsForFacts(
    supportFacts.map((fact) => fact.id),
    params.recallLexicalUnits,
  );
  const sourceRunSupportRank = new Map(
    selectedSourceRuns.map((sourceRunId, index) => [sourceRunId, index]),
  );
  const supportEntries = supportFacts.map((fact) => ({
    fact,
    exactContext: exactSupportContextKeys.has(sourceRunStateKey(fact) ?? ''),
    queryEvidenceScore: supportQueryEvidenceScore(
      fact,
      params.scoringQueryUnits,
      params.unitWeights,
    ),
    scored: buildScoredFact({
      fact,
      queryUnits: params.scoringQueryUnits,
      factUnitHits: supportUnitHits.get(fact.id),
      unitWeights: params.unitWeights,
      query: params.query,
      anchorUnitSets: params.anchorUnitSets,
      alwaysIncludePinned: params.alwaysIncludePinned,
      options: params.options,
      now: params.now,
    }),
  }));
  const rankedSupportEntries = rankWorkflowSupportEntries({
    entries: supportEntries,
    sourceRunSupportRank,
  });
  const procedureSourceRuns = new Set(
    procedureSupportAnchors
      .map((fact) => fact.sourceRunId)
      .filter((sourceRunId): sourceRunId is string => Boolean(sourceRunId)),
  );
  const procedureFirstSupportEntries =
    procedureSourceRuns.size > 0
      ? [
          ...rankedSupportEntries.filter((entry) =>
            procedureSourceRuns.has(entry.fact.sourceRunId ?? ''),
          ),
          ...rankedSupportEntries.filter(
            (entry) => !procedureSourceRuns.has(entry.fact.sourceRunId ?? ''),
          ),
        ]
      : rankedSupportEntries;
  const supportEntriesForSelection = sourceBalancedSupportEntries({
    entries: procedureFirstSupportEntries,
    selectedSourceRuns,
    supportSlots: params.reservedSupportSlots,
  });
  const sourceBalancedSupportIds = new Set(
    supportEntriesForSelection
      .slice(0, Math.min(params.reservedSupportSlots, selectedSourceRuns.length))
      .map((entry) => entry.fact.id),
  );
  for (const entry of supportEntriesForSelection) {
    const diversityKey = supportDiversityKey(entry.fact);
    const diversitySourceKey = diversityKey
      ? `${entry.fact.sourceRunId ?? ''}:${diversityKey}`
      : null;
    const isSourceBalancedSupport = sourceBalancedSupportIds.has(entry.fact.id);
    if (
      diversitySourceKey &&
      params.seenUiSupportDiversitySourceKeys.has(diversitySourceKey)
    ) {
      continue;
    }
    if (
      diversityKey &&
      params.seenUiSupportDiversityKeys.has(diversityKey) &&
      !isSourceBalancedSupport
    ) {
      continue;
    }
    const added = params.addSelectedSupportFact(
      entry.fact,
      supportLimit,
      isSourceBalancedSupport
        ? `source_balanced_support:${entry.fact.sourceRunId ?? ''}:${diversityKey ?? entry.fact.id}`
        : diversityKey,
    );
    if (added) {
      if (diversityKey) params.seenUiSupportDiversityKeys.add(diversityKey);
      if (diversitySourceKey) {
        params.seenUiSupportDiversitySourceKeys.add(diversitySourceKey);
      }
      params.scoredById.set(entry.fact.id, entry.scored);
    }
    if (params.selected.length >= supportLimit) break;
  }
}
