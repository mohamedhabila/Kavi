import { indexMemoryToSqlite, sqliteHybridSearch } from '../../services/memory/sqlite-store';
import {
  executeMemoryRecall as recallFacts,
  executeMemoryRemember as rememberFact,
  executeMemoryPin as pinFact,
  executeMemoryUnpin as unpinFact,
  executeMemoryForget as forgetFact,
  executeMemoryBlockRead as readMemoryBlock,
  executeMemoryBlockEdit as editMemoryBlock,
  type MemoryRecallArgs,
  type MemoryRememberArgs,
  type MemoryPinArgs,
  type MemoryForgetArgs,
  type MemoryBlockReadArgs,
  type MemoryBlockEditArgs,
} from '../../services/memory/memoryTools';
import type { EmbeddingConfig } from '../../types/memory';

export async function executeMemorySearch(
  args: { query: string; maxResults?: number; scope?: 'all' | 'conversation' | 'global' },
  embeddingConfig?: EmbeddingConfig,
  options?: { conversationId?: string },
): Promise<string> {
  const maxResults = args.maxResults || 10;
  const requestedScope = args.scope || 'all';

  const formatWithCitations = (
    results: Array<{ source: string; snippet: string; score: number; scope?: string }>,
    method: string,
  ) => {
    const cited = results.slice(0, maxResults).map((result, index) => ({
      ...result,
      scope: result.scope,
      citation: `[${index + 1}] ${result.source}`,
      relevance: Math.round(result.score * 100) + '%',
    }));
    return JSON.stringify({
      results: cited,
      method,
      totalFound: results.length,
      scope: requestedScope,
    });
  };

  try {
    await indexMemoryToSqlite(embeddingConfig, undefined, {
      scope: requestedScope,
      conversationId: options?.conversationId,
    });
    const persistentResults = await sqliteHybridSearch(
      args.query,
      {
        ...(embeddingConfig ? { embedding: embeddingConfig } : {}),
        maxResults,
      },
      {
        scope: requestedScope,
        conversationId: options?.conversationId,
      },
    );
    if (persistentResults.length > 0) {
      return JSON.stringify({
        results: persistentResults.map((result: any, index: number) => ({
          ...result,
          citation: `[${index + 1}] ${result.source || 'memory'}`,
          relevance: result.score != null ? Math.round(result.score * 100) + '%' : undefined,
        })),
        method: embeddingConfig ? 'hybrid' : 'text',
        index: 'sqlite',
        totalFound: persistentResults.length,
        scope: requestedScope,
      });
    }
  } catch (error) {
    return JSON.stringify({
      results: [],
      method: embeddingConfig ? 'hybrid' : 'text',
      index: 'sqlite',
      totalFound: 0,
      scope: requestedScope,
      degraded: true,
      error: error instanceof Error ? error.message : 'memory search unavailable',
    });
  }

  return formatWithCitations([], embeddingConfig ? 'hybrid' : 'text');
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

export function executeMemoryRemember(args: MemoryRememberArgs): string {
  return wrapMemoryToolResult(rememberFact(args));
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

export function executeMemoryBlockRead(args: MemoryBlockReadArgs = {}): string {
  return wrapMemoryToolResult(readMemoryBlock(args));
}

export function executeMemoryBlockEdit(args: MemoryBlockEditArgs): string {
  return wrapMemoryToolResult(editMemoryBlock(args));
}
