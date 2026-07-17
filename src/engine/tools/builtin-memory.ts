import {
  executeMemoryRecall as recallFacts,
  executeMemoryRemember as rememberFact,
  executeMemoryPin as pinFact,
  executeMemoryUnpin as unpinFact,
  executeMemoryForget as forgetFact,
  executeMemoryInvalidate as invalidateMemoryFact,
  type MemoryRecallArgs,
  type MemoryRecallExecutionContext,
  type MemoryRememberArgs,
  type MemoryRememberExecutionContext,
  type MemoryPinArgs,
  type MemoryFactActionExecutionContext,
  type MemoryForgetArgs,
  type MemoryInvalidateArgs,
} from '../../services/memory/memoryTools';
import { markFactsRecalled } from '../../services/memory/facts/factAccessMutations';
import { getEntityById } from '../../services/memory/entities';
import { recallFactSelectionForQuery } from '../../services/memory/factRecall';
import type { MemoryFact, MemoryFactScope } from '../../services/memory/facts/types';
import type { ScoredFact } from '../../services/memory/factRecallTypes';
import { resolveLocalMemoryAccessScope } from '../../services/memory/memoryScopeStore';
import { loadActiveMemoryFactConflictSignals } from '../../services/memory/facts/observations';
import { applyMemoryApplicabilityPolicy } from '../../services/memory/memoryApplicabilityPolicy';
import { selectMemoryApplicabilityResolutionFactIds } from '../../services/memory/memoryApplicabilityPrompt';
import type {
  MemoryApplicabilityAnnotation,
  MemoryApplicabilitySummary,
} from '../../services/memory/memoryApplicabilityTypes';
import { projectAgentRunExperienceViews } from '../../services/memory/experienceRecords';
import {
  isReceiptBackedProcedureLearningFact,
  resolveApplicableReceiptBackedProcedure,
} from '../../services/memory/receiptBackedProcedureRecall';
import { captureMemoryReadEpoch, isMemoryReadEpochCurrent } from '../../services/memory/policy';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

type MemorySearchScope = 'all' | 'conversation' | 'global';

export interface MemorySearchOptions {
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
}

const DEFAULT_MEMORY_SEARCH_LIMIT = 10;
const MAX_MEMORY_SEARCH_LIMIT = 50;

function clampMemorySearchLimit(value: unknown): number {
  return Math.max(
    1,
    Math.min(
      typeof value === 'number' && Number.isFinite(value)
        ? Math.floor(value)
        : DEFAULT_MEMORY_SEARCH_LIMIT,
      MAX_MEMORY_SEARCH_LIMIT,
    ),
  );
}

function normalizeMemorySearchScope(value: unknown): MemorySearchScope {
  return value === 'conversation' || value === 'global' || value === 'all' ? value : 'all';
}

function scopeFilterForSearch(
  scope: MemorySearchScope,
  conversationId: string | undefined,
): MemoryFactScope | MemoryFactScope[] | undefined {
  if (scope === 'global') return 'global';
  if (scope === 'conversation') return conversationId ? 'conversation' : undefined;
  return undefined;
}

function subjectLabel(subjectId: string): string {
  return getEntityById(subjectId)?.canonicalName ?? subjectId;
}

interface MemorySearchCandidate {
  id: string;
  fact: MemoryFact;
  score: number | null;
  relevanceScore: number | null;
  applicability: MemoryApplicabilityAnnotation;
  procedureAdvisory?: string;
}

function formatSearchResult(entry: MemorySearchCandidate, index: number): object {
  const { fact, applicability } = entry;
  const source = searchSourceForFact(entry);
  const experienceViews = projectAgentRunExperienceViews(fact);
  return {
    factId: fact.id,
    source,
    scope: fact.scope,
    kind: fact.memoryKind,
    subject: subjectLabel(fact.subjectId),
    predicate: fact.predicate,
    snippet: fact.objectText,
    score: entry.score,
    relevanceScore: entry.relevanceScore,
    citation: `[${index + 1}] ${source}`,
    relevance: entry.score === null ? null : `${Math.round(entry.score * 100)}%`,
    policy: applicability,
    ...(experienceViews.length > 0 ? { experienceViews } : {}),
    ...(entry.procedureAdvisory ? { procedureAdvisory: entry.procedureAdvisory } : {}),
  };
}

async function revalidateMemorySearchProcedures(input: {
  candidates: ReadonlyArray<MemorySearchCandidate>;
  memoryOwnerId: string;
  asOf: number;
}): Promise<MemorySearchCandidate[]> {
  const validated: MemorySearchCandidate[] = [];
  for (const candidate of input.candidates) {
    if (!isReceiptBackedProcedureLearningFact(candidate.fact)) {
      validated.push(candidate);
      continue;
    }
    if (candidate.applicability.action !== 'use') continue;
    const applicable = await resolveApplicableReceiptBackedProcedure({
      fact: candidate.fact,
      memoryOwnerId: input.memoryOwnerId,
      asOf: input.asOf,
    });
    if (applicable) {
      validated.push({ ...candidate, procedureAdvisory: applicable.section });
    }
  }
  return validated;
}

function searchSourceForFact(entry: Pick<MemorySearchCandidate, 'fact'>): string {
  return entry.fact.sourceRunId || entry.fact.sourceMessageId || entry.fact.id;
}

function selectSearchCandidates(input: {
  scoredFacts: ReadonlyArray<ScoredFact>;
  resolutionFacts: ReadonlyArray<MemoryFact>;
  decisions: ReturnType<typeof applyMemoryApplicabilityPolicy>['factDecisions'];
  limit: number;
}): MemorySearchCandidate[] {
  const scoredById = new Map(input.scoredFacts.map((entry) => [entry.fact.id, entry] as const));
  const factsById = new Map<string, MemoryFact>();
  for (const entry of input.scoredFacts) factsById.set(entry.fact.id, entry.fact);
  for (const fact of input.resolutionFacts) factsById.set(fact.id, fact);
  const annotated = input.decisions.flatMap((decision) => {
    const fact = factsById.get(decision.factId);
    if (!fact || decision.action === 'silent') return [];
    const scored = scoredById.get(fact.id);
    return [
      {
        id: fact.id,
        fact,
        score: scored?.score ?? null,
        relevanceScore: scored?.relevanceScore ?? null,
        applicability: { action: decision.action, reason: decision.reason },
      } satisfies MemorySearchCandidate,
    ];
  });
  const resolutionIds = selectMemoryApplicabilityResolutionFactIds(annotated);
  const policyResolution = annotated.filter((entry) => resolutionIds.has(entry.fact.id));
  const directlyUsable = annotated.filter(
    (entry) => entry.applicability.action === 'use' && !resolutionIds.has(entry.fact.id),
  );
  return [...policyResolution, ...directlyUsable].slice(0, input.limit);
}

const MEMORY_SEARCH_POLICY_INSTRUCTION =
  'Memory result policy is binding: use only action=use; ask the user before relying on action=ask; never assert or act on action=abstain.';

export async function executeMemorySearch(
  args: { query: string; maxResults?: number; scope?: 'all' | 'conversation' | 'global' },
  options: MemorySearchOptions,
): Promise<ToolRuntimeOutcome> {
  const memoryReadEpoch = captureMemoryReadEpoch();
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const maxResults = clampMemorySearchLimit(args.maxResults);
  const requestedScope = normalizeMemorySearchScope(args.scope);
  const conversationId = options.memoryConversationId;
  const optOutResult = () =>
    failedToolOutcome(
      JSON.stringify({
        results: [],
        method: 'living_memory',
        index: 'memory_facts',
        totalFound: 0,
        scope: requestedScope,
        outcome: 'opt_out',
      }),
    );
  if (memoryReadEpoch === null || !isMemoryReadEpochCurrent(memoryReadEpoch)) {
    return optOutResult();
  }
  try {
    if (!query) {
      return failedToolOutcome(
        JSON.stringify({
          results: [],
          method: 'living_memory',
          index: 'memory_facts',
          totalFound: 0,
          scope: requestedScope,
        }),
      );
    }
    if (requestedScope === 'conversation' && !conversationId) {
      return failedToolOutcome(
        JSON.stringify({
          results: [],
          method: 'living_memory',
          index: 'memory_facts',
          totalFound: 0,
          scope: requestedScope,
        }),
      );
    }
    const scopeFilter = scopeFilterForSearch(requestedScope, conversationId);
    const memoryScope = resolveLocalMemoryAccessScope({
      memoryConversationId: options.memoryConversationId,
      sourceThreadId: options.sourceThreadId,
      personaId: options.personaId,
      taskId: options.taskId,
    });
    const now = Date.now();
    const selection = await recallFactSelectionForQuery(query, {
      limit: maxResults,
      threshold: 0.01,
      memoryScope,
      useIntent: 'automatic_prompt',
      now,
      ...(scopeFilter ? { scopeFilter } : {}),
      memoryReadEpoch,
    });
    if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return optOutResult();
    const candidateFacts = [...selection.facts, ...selection.resolutionFacts];
    let conflictObservationReadState: 'available' | 'failed' = 'available';
    let persistedConflicts: ReturnType<typeof loadActiveMemoryFactConflictSignals> = [];
    try {
      persistedConflicts = loadActiveMemoryFactConflictSignals({
        factIds: candidateFacts.map((fact) => fact.id),
        currentScope: memoryScope,
        asOf: now,
      });
    } catch {
      conflictObservationReadState = 'failed';
    }
    const applicability = applyMemoryApplicabilityPolicy({
      facts: candidateFacts,
      context: {
        enabled: true,
        now,
        useIntent: 'automatic_prompt',
        scope: memoryScope,
        conflictObservationReadState,
        ...(persistedConflicts.length > 0 ? { externalEvidence: persistedConflicts } : {}),
      },
    });
    const policySelected = selectSearchCandidates({
      scoredFacts: selection.scoredFacts,
      resolutionFacts: selection.resolutionFacts,
      decisions: applicability.factDecisions,
      limit: maxResults,
    });
    const selected = await revalidateMemorySearchProcedures({
      candidates: policySelected,
      memoryOwnerId: memoryScope.memoryOwnerId,
      asOf: now,
    });
    const applicabilitySummary: MemoryApplicabilitySummary = {
      ...applicability.summary,
      promptVisibleFactCount: selected.length,
      promptBudgetDroppedFactCount: Math.max(
        0,
        applicability.summary.promptVisibleFactCount - selected.length,
      ),
    };
    if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return optOutResult();
    markFactsRecalled(
      selected.map((entry) => entry.fact.id),
      now,
    );
    if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return optOutResult();
    return completedToolOutcome(
      JSON.stringify({
        results: selected.map(formatSearchResult),
        method: 'living_memory',
        index: 'memory_facts',
        totalFound: selected.length,
        scope: requestedScope,
        policyInstruction: MEMORY_SEARCH_POLICY_INSTRUCTION,
        applicabilityPolicy: applicabilitySummary,
        ...(applicabilitySummary.state === 'degraded' ? { degraded: true } : {}),
      }),
    );
  } catch (error) {
    if (!isMemoryReadEpochCurrent(memoryReadEpoch)) return optOutResult();
    return failedToolOutcome(
      JSON.stringify({
        results: [],
        method: 'living_memory',
        index: 'memory_facts',
        totalFound: 0,
        scope: requestedScope,
        degraded: true,
        error: error instanceof Error ? error.message : 'memory search unavailable',
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Living-memory fact tool wrappers.
//
// These are thin adapters over `services/memory/memoryTools.ts` that:
//   • return JSON strings (matching the rest of the builtin executor convention)
//   • preserve the service's tagged rejection versus unknown-failure status
//     instead of throwing, so durability can classify the effect fail-closed
// ---------------------------------------------------------------------------

function wrapMemoryToolResult(result: { ok: boolean }): ToolRuntimeOutcome {
  const content = JSON.stringify(result);
  return result.ok ? completedToolOutcome(content) : failedToolOutcome(content);
}

export function executeMemoryRecall(
  args: MemoryRecallArgs,
  context: MemoryRecallExecutionContext,
): ToolRuntimeOutcome {
  return wrapMemoryToolResult(recallFacts(args, context));
}

export function executeMemoryRemember(
  args: MemoryRememberArgs,
  context: MemoryRememberExecutionContext,
): ToolRuntimeOutcome {
  return wrapMemoryToolResult(rememberFact(args, context));
}

export function executeMemoryPin(
  args: MemoryPinArgs,
  context: MemoryFactActionExecutionContext,
): ToolRuntimeOutcome {
  return wrapMemoryToolResult(pinFact(args, context));
}

export function executeMemoryUnpin(
  args: MemoryPinArgs,
  context: MemoryFactActionExecutionContext,
): ToolRuntimeOutcome {
  return wrapMemoryToolResult(unpinFact(args, context));
}

export function executeMemoryForget(
  args: MemoryForgetArgs,
  context: MemoryFactActionExecutionContext,
): ToolRuntimeOutcome {
  return wrapMemoryToolResult(forgetFact(args, context));
}

export function executeMemoryInvalidate(
  args: MemoryInvalidateArgs,
  context: MemoryFactActionExecutionContext,
): ToolRuntimeOutcome {
  return wrapMemoryToolResult(invalidateMemoryFact(args, context));
}
