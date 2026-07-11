// ---------------------------------------------------------------------------
// Kavi — Embedding Memory Service
// ---------------------------------------------------------------------------
// Provides embedding generation and a bounded in-memory result cache.
// Supports: local Unicode n-gram hashing, OpenAI, Gemini, Voyage, Mistral, Ollama.

import type { EmbeddingConfig, EmbeddingResult } from '../../types/memory';
import {
  DEFAULT_GEMINI_AI_STUDIO_BASE_URL,
  isVertexNativeGeminiBaseUrl,
  normalizeGeminiBaseUrl,
} from '../../constants/api';
import { getSecure } from '../storage/SecureStorage';
import { createTimeoutSignal } from '../../utils/runtime';
import {
  createCharacterNgramVector,
  LOCAL_SIMILARITY_DIMENSIONS,
  LOCAL_SIMILARITY_MAXIMUM_DIMENSIONS,
  LOCAL_SIMILARITY_MINIMUM_DIMENSIONS,
  LOCAL_SIMILARITY_MODEL,
} from './localSimilarity';

const EMBEDDING_TIMEOUT_MS = 30_000;

export const DEFAULT_LOCAL_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: 'local',
  model: LOCAL_SIMILARITY_MODEL,
  dimensions: LOCAL_SIMILARITY_DIMENSIONS,
};

/** Create an AbortSignal that fires after `ms` milliseconds. */
function timeoutSignal(ms: number = EMBEDDING_TIMEOUT_MS): AbortSignal {
  return createTimeoutSignal(ms);
}

// ── Provider-specific embedding fetchers ─────────────────────────────────

function clampLocalDimensions(dimensions: number | undefined): number {
  if (!Number.isFinite(dimensions ?? NaN)) return LOCAL_SIMILARITY_DIMENSIONS;
  return Math.max(
    LOCAL_SIMILARITY_MINIMUM_DIMENSIONS,
    Math.min(
      Math.floor(dimensions ?? LOCAL_SIMILARITY_DIMENSIONS),
      LOCAL_SIMILARITY_MAXIMUM_DIMENSIONS,
    ),
  );
}

function hashString32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

async function fetchLocalEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult> {
  const dimensions = clampLocalDimensions(config.dimensions);
  return {
    embedding: createCharacterNgramVector(text, dimensions),
    model: config.model || LOCAL_SIMILARITY_MODEL,
  };
}

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
    case 'local':
      return fetchLocalEmbedding(text, config);
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

function getCacheKey(text: string, config: EmbeddingConfig): string {
  return [
    config.provider,
    config.model ?? '',
    config.dimensions ?? '',
    hashString32(text),
    text.length,
  ].join(':');
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
  const key = getCacheKey(text, config);
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

export function clearEmbeddingCache(): number {
  const cleared = embeddingCache.size;
  embeddingCache.clear();
  return cleared;
}

export function getEmbeddingCacheEntryCount(): number {
  evictExpiredCacheEntries();
  return embeddingCache.size;
}

export function isLocalEmbeddingConfig(config: EmbeddingConfig | undefined): boolean {
  return config?.provider === 'local';
}
