import type { MemorySearchResult } from '../../../types/memory';
import { cosineSimilarity } from './similarity';
import { combineHybridScore, temporalDecay } from './scoring';

export type ChunkScope = 'global' | 'conversation' | 'daily';
export type ChunkSearchScope = 'global' | 'conversation' | 'all';

export interface SearchableMemoryChunk {
  source: string;
  content: string;
  timestamp: number;
  scope: ChunkScope;
  embedding?: number[] | null;
  conversationId?: string | null;
  taskId?: string | null;
  projectId?: string | null;
}

export interface ChunkSearchOptions {
  scope?: ChunkSearchScope;
  conversationId?: string;
  taskId?: string;
  projectId?: string;
}

export interface ChunkIndex<T extends SearchableMemoryChunk = SearchableMemoryChunk> {
  listChunks(): T[] | Promise<T[]>;
}

export interface SearchChunkIndexInput<T extends SearchableMemoryChunk> {
  index: ChunkIndex<T>;
  queryEmbedding: number[] | null;
  options?: ChunkSearchOptions;
  vectorWeight: number;
  textWeight: number;
  temporalWeight: number;
  maxResults: number;
  textScore: (chunk: T) => number;
  includeEmbeddingInResult?: boolean;
  dedupeBySnippetPrefix?: boolean;
  scoreThreshold?: number;
}

export function createArrayChunkIndex<T extends SearchableMemoryChunk>(
  entries: T[],
): ChunkIndex<T> {
  return {
    listChunks: () => entries,
  };
}

export function chunkMatchesSearchOptions(
  chunk: SearchableMemoryChunk,
  options: ChunkSearchOptions = {},
): boolean {
  const requestedScope = options.scope || 'global';

  if (requestedScope === 'global' && chunk.scope === 'conversation') {
    return false;
  }
  if (requestedScope === 'conversation') {
    if (chunk.scope !== 'conversation') return false;
    if (options.conversationId && chunk.conversationId !== options.conversationId) return false;
  }
  if (requestedScope === 'all' && chunk.scope === 'conversation' && options.conversationId) {
    if (chunk.conversationId !== options.conversationId) return false;
  }
  if (options.taskId && chunk.taskId && chunk.taskId !== options.taskId) {
    return false;
  }
  if (options.projectId && chunk.projectId && chunk.projectId !== options.projectId) {
    return false;
  }

  return true;
}

export function dedupeSearchResultsBySnippetPrefix(
  results: MemorySearchResult[],
  maxResults: number,
  prefixLength = 100,
): MemorySearchResult[] {
  const seen = new Set<string>();
  const deduped: MemorySearchResult[] = [];
  for (const result of results) {
    const key = result.snippet.slice(0, prefixLength);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
    if (deduped.length >= maxResults) break;
  }
  return deduped;
}

export async function searchChunkIndex<T extends SearchableMemoryChunk>(
  input: SearchChunkIndexInput<T>,
): Promise<MemorySearchResult[]> {
  const chunks = await input.index.listChunks();
  const scored: MemorySearchResult[] = [];
  const threshold = input.scoreThreshold ?? 0.01;

  for (const chunk of chunks) {
    if (!chunkMatchesSearchOptions(chunk, input.options)) continue;

    const vectorScore =
      input.queryEmbedding && chunk.embedding
        ? cosineSimilarity(input.queryEmbedding, chunk.embedding)
        : 0;
    const textScore = input.textScore(chunk);
    const temporalScore = temporalDecay(chunk.timestamp);
    const combinedScore = combineHybridScore({
      vectorScore,
      textScore,
      temporalScore,
      vectorWeight: input.vectorWeight,
      textWeight: input.textWeight,
      temporalWeight: input.temporalWeight,
    });

    if (combinedScore > threshold) {
      scored.push({
        source: chunk.source,
        scope: chunk.scope,
        snippet: chunk.content.slice(0, 500),
        score: combinedScore,
        ...(input.includeEmbeddingInResult ? { embedding: chunk.embedding ?? undefined } : {}),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  if (input.dedupeBySnippetPrefix) {
    return dedupeSearchResultsBySnippetPrefix(scored, input.maxResults);
  }
  return scored.slice(0, input.maxResults);
}
