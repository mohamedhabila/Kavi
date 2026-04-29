import { hybridSearch } from '../../services/memory/embeddings';
import { searchMemory } from '../../services/memory/store';
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
import type { EmbeddingConfig } from '../../types';

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

  if (!embeddingConfig) {
    const results = await searchMemory(args.query, {
      scope: requestedScope,
      conversationId: options?.conversationId,
    });
    return formatWithCitations(results, 'text');
  }

  try {
    const results = await hybridSearch(
      args.query,
      {
        embedding: embeddingConfig,
        maxResults,
      },
      {
        scope: requestedScope,
        conversationId: options?.conversationId,
      },
    );
    return JSON.stringify({
      results: results.map((result: any, index: number) => ({
        ...result,
        citation: `[${index + 1}] ${result.source || 'memory'}`,
        relevance: result.score != null ? Math.round(result.score * 100) + '%' : undefined,
      })),
      method: 'hybrid',
      totalFound: results.length,
      scope: requestedScope,
    });
  } catch {
    const results = await searchMemory(args.query, {
      scope: requestedScope,
      conversationId: options?.conversationId,
    });
    return formatWithCitations(results, 'text_fallback');
  }
}

// ---------------------------------------------------------------------------
// Living-memory fact/block tool wrappers.
//
// These are thin adapters over `services/memory/memoryTools.ts` that:
//   • return JSON strings (matching the rest of the parity executor convention)
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