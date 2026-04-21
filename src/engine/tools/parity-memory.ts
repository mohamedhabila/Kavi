import { hybridSearch } from '../../services/memory/embeddings';
import { searchMemory } from '../../services/memory/store';
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