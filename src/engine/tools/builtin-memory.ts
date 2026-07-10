import {
  executeMemoryRecall as recallFacts,
  executeMemoryRemember as rememberFact,
  executeMemoryPin as pinFact,
  executeMemoryUnpin as unpinFact,
  executeMemoryForget as forgetFact,
  executeMemoryInvalidate as invalidateFact,
  executeMemoryBlockRead as readMemoryBlock,
  executeMemoryBlockEdit as editMemoryBlock,
  type MemoryRecallArgs,
  type MemoryRememberArgs,
  type MemoryRememberExecutionContext,
  type MemoryPinArgs,
  type MemoryForgetArgs,
  type MemoryInvalidateArgs,
  type MemoryBlockReadArgs,
  type MemoryBlockEditArgs,
} from '../../services/memory/memoryTools';
import { markFactsRecalled } from '../../services/memory/facts/mutations';
import { getEntityById } from '../../services/memory/entities';
import { recallScoredFactsForQuery } from '../../services/memory/factRecall';
import type { MemoryFactScope } from '../../services/memory/facts/types';
import type { ScoredFact } from '../../services/memory/factRecallTypes';

type MemorySearchScope = 'all' | 'conversation' | 'global';

export interface MemorySearchOptions {
  conversationId?: string;
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

function searchSourceForFact(entry: ScoredFact): string {
  return entry.fact.sourceRunId || entry.fact.sourceMessageId || entry.fact.id;
}

function subjectLabel(subjectId: string): string {
  return getEntityById(subjectId)?.canonicalName ?? subjectId;
}

function formatSearchResult(entry: ScoredFact, index: number): object {
  const fact = entry.fact;
  const source = searchSourceForFact(entry);
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
    relevance: `${Math.round(entry.score * 100)}%`,
  };
}

export async function executeMemorySearch(
  args: { query: string; maxResults?: number; scope?: 'all' | 'conversation' | 'global' },
  options: MemorySearchOptions = {},
): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const maxResults = clampMemorySearchLimit(args.maxResults);
  const requestedScope = normalizeMemorySearchScope(args.scope);
  const conversationId = options.conversationId?.trim() || undefined;
  try {
    if (!query) {
      return JSON.stringify({
        results: [],
        method: 'living_memory',
        index: 'memory_facts',
        totalFound: 0,
        scope: requestedScope,
      });
    }
    if (requestedScope === 'conversation' && !conversationId) {
      return JSON.stringify({
        results: [],
        method: 'living_memory',
        index: 'memory_facts',
        totalFound: 0,
        scope: requestedScope,
      });
    }
    const scopeFilter = scopeFilterForSearch(requestedScope, conversationId);
    const scored = await recallScoredFactsForQuery(query, {
      limit: maxResults,
      threshold: 0.01,
      ...(requestedScope !== 'global' && conversationId ? { conversationId } : {}),
      ...(scopeFilter ? { scopeFilter } : {}),
    });
    markFactsRecalled(
      scored.map((entry) => entry.fact.id),
      Date.now(),
    );
    return JSON.stringify({
      results: scored.map(formatSearchResult),
      method: 'living_memory',
      index: 'memory_facts',
      totalFound: scored.length,
      scope: requestedScope,
    });
  } catch (error) {
    return JSON.stringify({
      results: [],
      method: 'living_memory',
      index: 'memory_facts',
      totalFound: 0,
      scope: requestedScope,
      degraded: true,
      error: error instanceof Error ? error.message : 'memory search unavailable',
    });
  }
}

// ---------------------------------------------------------------------------
// Living-memory fact/block tool wrappers.
//
// These are thin adapters over `services/memory/memoryTools.ts` that:
//   • return JSON strings (matching the rest of the builtin executor convention)
//   • surface MemoryToolError as `{ ok: false, error, message }` JSON instead
//     of throwing, so the agent runtime can format them as tool-call errors
// ---------------------------------------------------------------------------

function wrapMemoryToolResult(result: unknown): string {
  return JSON.stringify(result);
}

export function executeMemoryRecall(args: MemoryRecallArgs): string {
  return wrapMemoryToolResult(recallFacts(args));
}

export function executeMemoryRemember(
  args: MemoryRememberArgs,
  context?: MemoryRememberExecutionContext,
): string {
  return wrapMemoryToolResult(rememberFact(args, context));
}

export function executeMemoryPin(args: MemoryPinArgs): string {
  return wrapMemoryToolResult(pinFact(args));
}

export function executeMemoryUnpin(args: MemoryPinArgs): string {
  return wrapMemoryToolResult(unpinFact(args));
}

export function executeMemoryForget(args: MemoryForgetArgs): string {
  return wrapMemoryToolResult(forgetFact(args));
}

export function executeMemoryInvalidate(args: MemoryInvalidateArgs): string {
  return wrapMemoryToolResult(invalidateFact(args));
}

export function executeMemoryBlockRead(args: MemoryBlockReadArgs = {}): string {
  return wrapMemoryToolResult(readMemoryBlock(args));
}

export function executeMemoryBlockEdit(args: MemoryBlockEditArgs): string {
  return wrapMemoryToolResult(editMemoryBlock(args));
}
