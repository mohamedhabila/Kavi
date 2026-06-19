export type EmbeddingProvider = 'openai' | 'gemini' | 'voyage' | 'mistral' | 'ollama';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}

export interface MemorySearchResult {
  source: string;
  snippet: string;
  score: number;
  scope?: 'global' | 'conversation' | 'daily';
  embedding?: number[];
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokens?: number;
}
