// ---------------------------------------------------------------------------
// Kavi — Embedding Memory Service
// ---------------------------------------------------------------------------
// Provides embedding-based semantic memory search using remote APIs.
// Supports: OpenAI, Gemini, Voyage, Mistral, Ollama.
// Scoring: vectorWeight * cosine + textWeight * bm25 + temporal_decay + mmr

import type {
  EmbeddingProvider,
  EmbeddingConfig,
  EmbeddingResult,
  MemorySearchResult,
} from '../../types/memory';
import {
  DEFAULT_GEMINI_AI_STUDIO_BASE_URL,
  isVertexNativeGeminiBaseUrl,
  normalizeGeminiBaseUrl,
} from '../../constants/api';
import { getSecure } from '../storage/SecureStorage';
import {
  searchMemory,
  readConversationMemory,
  readGlobalMemory,
  listDailyMemoryFiles,
  readDailyMemory,
} from './store';
import { createTimeoutSignal } from '../../utils/runtime';
import { createArrayChunkIndex, searchChunkIndex } from './ranking/chunkIndex';

const EMBEDDING_TIMEOUT_MS = 30_000;

export { cosineSimilarity } from './ranking/similarity';
export { temporalDecay } from './ranking/scoring';

/** Create an AbortSignal that fires after `ms` milliseconds. */
function timeoutSignal(ms: number = EMBEDDING_TIMEOUT_MS): AbortSignal {
  return createTimeoutSignal(ms);
}

// ── Provider-specific embedding fetchers ─────────────────────────────────

async function fetchOpenAIEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey || (await getSecure('OPENAI_API_KEY'));
  if (!apiKey) throw new Error('OpenAI API key required for embeddings');

  const res = await fetch(`${config.baseUrl || 'https://api.openai.com'}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.model || 'text-embedding-3-small',
      input: text,
      dimensions: config.dimensions || 1536,
    }),
    signal: timeoutSignal(),
  });

  if (!res.ok) throw new Error(`OpenAI embeddings error: HTTP ${res.status}`);
  const data = await res.json();
  return {
    embedding: data.data[0].embedding,
    model: data.model,
    tokens: data.usage?.total_tokens,
  };
}

async function fetchGeminiEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey || (await getSecure('GEMINI_API_KEY'));
  if (!apiKey) throw new Error('Gemini API key required for embeddings');

  const configuredBaseUrl = (config.baseUrl || '').trim();
  const usesVertexNativeEndpoint = isVertexNativeGeminiBaseUrl(configuredBaseUrl);

  if (usesVertexNativeEndpoint) {
    const baseUrl = normalizeGeminiBaseUrl(configuredBaseUrl);
    if (!/\/projects\/[^/]+\/locations\/[^/]+$/i.test(baseUrl)) {
      throw new Error('Vertex Gemini embeddings require a project/location-scoped base URL');
    }

    const model = config.model || 'gemini-embedding-001';
    const res = await fetch(
      `${baseUrl}/publishers/google/models/${encodeURIComponent(model)}:predict`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          instances: [
            {
              content: text,
              task_type: 'RETRIEVAL_QUERY',
            },
          ],
          parameters: {
            autoTruncate: true,
            ...(config.dimensions ? { outputDimensionality: config.dimensions } : {}),
          },
        }),
        signal: timeoutSignal(),
      },
    );

    if (!res.ok) throw new Error(`Gemini embeddings error: HTTP ${res.status}`);
    const data = await res.json();
    const prediction = Array.isArray(data?.predictions) ? data.predictions[0] : undefined;
    const values = prediction?.embeddings?.values;
    if (!Array.isArray(values)) {
      throw new Error('Gemini embeddings response returned no embedding vector');
    }

    return {
      embedding: values,
      model,
      tokens: prediction?.embeddings?.statistics?.token_count,
    };
  }

  const baseUrl = normalizeGeminiBaseUrl(configuredBaseUrl || DEFAULT_GEMINI_AI_STUDIO_BASE_URL);
  const model = config.model || 'text-embedding-004';
  const res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:embedContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    }),
    signal: timeoutSignal(),
  });

  if (!res.ok) throw new Error(`Gemini embeddings error: HTTP ${res.status}`);
  const data = await res.json();
  return { embedding: data.embedding.values, model };
}

async function fetchVoyageEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey || (await getSecure('VOYAGE_API_KEY'));
  if (!apiKey) throw new Error('Voyage API key required for embeddings');

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.model || 'voyage-3-lite',
      input: [text],
      input_type: 'query',
    }),
    signal: timeoutSignal(),
  });

  if (!res.ok) throw new Error(`Voyage embeddings error: HTTP ${res.status}`);
  const data = await res.json();
  return { embedding: data.data[0].embedding, model: data.model, tokens: data.usage?.total_tokens };
}

async function fetchMistralEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const apiKey = config.apiKey || (await getSecure('MISTRAL_API_KEY'));
  if (!apiKey) throw new Error('Mistral API key required for embeddings');

  const res = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.model || 'mistral-embed',
      input: [text],
    }),
    signal: timeoutSignal(),
  });

  if (!res.ok) throw new Error(`Mistral embeddings error: HTTP ${res.status}`);
  const data = await res.json();
  return { embedding: data.data[0].embedding, model: data.model };
}

async function fetchOllamaEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const baseUrl = config.baseUrl || 'http://localhost:11434';
  const res = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'nomic-embed-text',
      input: text,
    }),
    signal: timeoutSignal(),
  });

  if (!res.ok) throw new Error(`Ollama embeddings error: HTTP ${res.status}`);
  const data = await res.json();
  return {
    embedding: data.embeddings?.[0] ?? data.embedding,
    model: config.model || 'nomic-embed-text',
  };
}

// ── Main embedding function ──────────────────────────────────────────────

export async function getEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  switch (config.provider) {
    case 'openai':
      return fetchOpenAIEmbedding(text, config);
    case 'gemini':
      return fetchGeminiEmbedding(text, config);
    case 'voyage':
      return fetchVoyageEmbedding(text, config);
    case 'mistral':
      return fetchMistralEmbedding(text, config);
    case 'ollama':
      return fetchOllamaEmbedding(text, config);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

// ── Embedding cache (in-memory) ──────────────────────────────────────────

const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
export const CACHE_CONFIG = { maxSize: 500 };

function getCacheKey(text: string, provider: EmbeddingProvider): string {
  return `${provider}:${text.slice(0, 200)}`;
}

function evictExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of embeddingCache) {
    if (now - entry.timestamp >= CACHE_TTL) {
      embeddingCache.delete(key);
    }
  }
}

export async function getEmbeddingCached(text: string, config: EmbeddingConfig): Promise<number[]> {
  const key = getCacheKey(text, config.provider);
  const cached = embeddingCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.embedding;
  }
  const result = await getEmbedding(text, config);
  // Evict expired entries and cap cache size
  if (embeddingCache.size >= CACHE_CONFIG.maxSize) {
    evictExpiredCacheEntries();
    // If still over limit, remove oldest entries
    if (embeddingCache.size >= CACHE_CONFIG.maxSize) {
      const keysIter = embeddingCache.keys();
      const toRemove = embeddingCache.size - CACHE_CONFIG.maxSize + 1;
      for (let i = 0; i < toRemove; i++) {
        const oldest = keysIter.next().value;
        if (oldest) embeddingCache.delete(oldest);
      }
    }
  }
  embeddingCache.set(key, { embedding: result.embedding, timestamp: Date.now() });
  return result.embedding;
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

// ── Hybrid memory search (text + embedding) ──────────────────────────────

export interface HybridSearchConfig {
  embedding: EmbeddingConfig;
  vectorWeight?: number;
  textWeight?: number;
  temporalWeight?: number;
  maxResults?: number;
}

export interface MemoryIndexOptions {
  scope?: 'global' | 'conversation' | 'all';
  conversationId?: string;
  maxDailyFiles?: number;
}

export interface IndexedMemoryEntry {
  scope: 'global' | 'conversation' | 'daily';
  source: string;
  content: string;
  timestamp: number;
  embedding?: number[];
}

// In-memory index of embedded entries
const memoryIndex: IndexedMemoryEntry[] = [];

function includesGlobalLikeMemory(scope: MemoryIndexOptions['scope'] | undefined): boolean {
  return !scope || scope === 'global' || scope === 'all';
}

function includesConversationMemory(scope: MemoryIndexOptions['scope'] | undefined): boolean {
  return scope === 'conversation' || scope === 'all';
}

/**
 * Index all memory entries with embeddings for semantic search
 */
export async function indexMemory(
  config: EmbeddingConfig,
  options?: MemoryIndexOptions,
): Promise<number> {
  memoryIndex.length = 0;
  const scope = options?.scope;
  const maxDailyFiles = options?.maxDailyFiles || 30;

  if (includesGlobalLikeMemory(scope)) {
    const global = await readGlobalMemory();
    if (global) {
      const sections = global.split(/\n(?=#{1,3}\s)/);
      for (const section of sections) {
        if (!section.trim()) continue;
        try {
          const embedding = await getEmbeddingCached(section.trim(), config);
          memoryIndex.push({
            scope: 'global',
            source: 'MEMORY.md',
            content: section.trim(),
            timestamp: Date.now(),
            embedding,
          });
        } catch {
          memoryIndex.push({
            scope: 'global',
            source: 'MEMORY.md',
            content: section.trim(),
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  if (includesConversationMemory(scope) && options?.conversationId) {
    const conversationMemory = await readConversationMemory(options.conversationId);
    if (conversationMemory) {
      const sections = conversationMemory.split(/\n(?=#{1,3}\s)/);
      for (const section of sections) {
        if (!section.trim()) continue;
        try {
          const embedding = await getEmbeddingCached(section.trim(), config);
          memoryIndex.push({
            scope: 'conversation',
            source: 'conversation/MEMORY.md',
            content: section.trim(),
            timestamp: Date.now(),
            embedding,
          });
        } catch {
          memoryIndex.push({
            scope: 'conversation',
            source: 'conversation/MEMORY.md',
            content: section.trim(),
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  if (includesGlobalLikeMemory(scope)) {
    const dailyFiles = listDailyMemoryFiles();
    for (const dateStr of dailyFiles.slice(0, maxDailyFiles)) {
      const content = await readDailyMemory(dateStr);
      if (!content) continue;

      const dateMs = new Date(dateStr).getTime() || Date.now();
      const sections = content.split(/\n---\n/);
      for (const section of sections) {
        if (!section.trim()) continue;
        try {
          const embedding = await getEmbeddingCached(section.trim(), config);
          memoryIndex.push({
            scope: 'daily',
            source: `daily/${dateStr}.md`,
            content: section.trim(),
            timestamp: dateMs,
            embedding,
          });
        } catch {
          memoryIndex.push({
            scope: 'daily',
            source: `daily/${dateStr}.md`,
            content: section.trim(),
            timestamp: dateMs,
          });
        }
      }
    }
  }

  return memoryIndex.length;
}

/**
 * Hybrid search combining vector similarity, text matching, and temporal decay
 */
export async function hybridSearch(
  query: string,
  config: HybridSearchConfig,
  options?: MemoryIndexOptions,
): Promise<MemorySearchResult[]> {
  const { vectorWeight = 0.6, textWeight = 0.3, temporalWeight = 0.1, maxResults = 10 } = config;

  // Get query embedding
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await getEmbeddingCached(query, config.embedding);
  } catch {
    // Fall back to text-only search
  }

  // Get text search results
  const textResults = await searchMemory(query, {
    scope: options?.scope || 'global',
    conversationId: options?.conversationId,
    maxDailyFiles: options?.maxDailyFiles,
  });
  const textScoreMap = new Map<string, number>();
  for (const r of textResults) {
    textScoreMap.set(r.snippet.slice(0, 200), r.score);
  }

  // If no indexed entries, fall back to pure text search
  if (memoryIndex.length === 0) {
    return textResults.slice(0, maxResults);
  }

  return searchChunkIndex({
    index: createArrayChunkIndex(memoryIndex),
    queryEmbedding,
    options: options?.scope ? { scope: options.scope } : undefined,
    vectorWeight,
    textWeight,
    temporalWeight,
    maxResults,
    textScore: (entry) => textScoreMap.get(entry.content.slice(0, 200)) || 0,
    includeEmbeddingInResult: true,
  });
}

/**
 * Get the number of indexed entries
 */
export function getIndexSize(): number {
  return memoryIndex.length;
}
