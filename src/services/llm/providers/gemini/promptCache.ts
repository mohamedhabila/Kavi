export type GeminiPromptCacheTelemetrySnapshot = {
  cacheCreateAttempts: number;
  cacheCreateFailureCount: number;
  cacheCreateFailuresByProviderStatus: Array<{
    providerStatus: string;
    count: number;
  }>;
  cacheCreateTelemetryAvailable: boolean;
};

export function getGeminiPromptCacheTelemetrySnapshot(): GeminiPromptCacheTelemetrySnapshot {
  return {
    cacheCreateAttempts: 0,
    cacheCreateFailureCount: 0,
    cacheCreateFailuresByProviderStatus: [],
    cacheCreateTelemetryAvailable: true,
  };
}

export function resetGeminiPromptCacheForTests(): void {
  // Gemini native uses provider-managed implicit caching; no local cache state exists.
}
