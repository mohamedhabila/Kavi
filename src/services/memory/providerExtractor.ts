// ---------------------------------------------------------------------------
// Kavi — Provider-based Memory Extractor (Optional Enrichment)
// ---------------------------------------------------------------------------
// Thin wrapper around the existing LLM consolidator. Only called when a
// provider is available. Enhances the deterministic extraction with deeper
// semantic analysis.
//
// This is an OPTIONAL layer. Memory works perfectly without it.
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

/**
 * Run the LLM extractor on a turn and return parsed results.
 * Safe: never throws. Returns empty result on any failure.
 */
export async function extractProviderEnrichment(
  input: ConsolidatorTurnInput,
  options: ProviderEnrichmentOptions,
): Promise<ConsolidatorResult> {
  try {
    const result = await consolidateTurn(input, {
      extractor: options.extractor,
      persist: false,
      now: options.now,
    });
    return result;
  } catch {
    return {
      episodeSummary: null,
      newFacts: [],
      invalidatedFacts: [],
      activeFocus: null,
      openThreads: [],
      notable: [],
    };
  }
}
