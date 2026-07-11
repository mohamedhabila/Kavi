export type EmbeddingProvider = 'openai' | 'gemini' | 'voyage' | 'mistral' | 'ollama' | 'local';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokens?: number;
}
