// ---------------------------------------------------------------------------
// Kavi - Provider-based Memory Extractor
// ---------------------------------------------------------------------------
// Thin wrapper around the existing LLM consolidator. Only called when a
// provider is available. Enhances structural extraction with deeper semantic
// analysis. Provider failures propagate so the queue can retry and surface a
// degraded memory-enrichment state instead of recording empty memory as success.
// ---------------------------------------------------------------------------

import type {
  ConsolidatorExtractor,
  ConsolidatorOutcome,
  ConsolidatorTurnInput,
} from './consolidator';
import { consolidateTurn } from './consolidator';

export interface ProviderEnrichmentOptions {
  extractor: ConsolidatorExtractor;
  signal?: AbortSignal;
}

export async function extractProviderEnrichment(
  input: ConsolidatorTurnInput,
  options: ProviderEnrichmentOptions,
): Promise<ConsolidatorOutcome> {
  return consolidateTurn(input, {
    extractor: options.extractor,
    signal: options.signal,
  });
}
