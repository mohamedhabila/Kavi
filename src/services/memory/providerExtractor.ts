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
  ConsolidatorResult,
  ConsolidatorTurnInput,
} from './consolidator';
import { consolidateTurn } from './consolidator';

export interface ProviderEnrichmentOptions {
  extractor: ConsolidatorExtractor;
  now?: () => number;
}

export async function extractProviderEnrichment(
  input: ConsolidatorTurnInput,
  options: ProviderEnrichmentOptions,
): Promise<ConsolidatorResult> {
  return consolidateTurn(input, {
    extractor: options.extractor,
    persist: false,
    now: options.now,
  });
}
