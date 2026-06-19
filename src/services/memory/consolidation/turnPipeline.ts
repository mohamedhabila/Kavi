import type { LlmProviderConfig } from '../../../types/provider';
import type { ConsolidatorExtractor } from '../consolidator';
import {
  processIngestionTurn,
  type ProcessTurnInput,
  type ProcessTurnResult,
} from '../turnProcessor';
import { resolveConsolidationPath, type ResolvedConsolidationPath } from './paths';

export interface ResolveConsolidationExtractorInput {
  activeChatProvider?: LlmProviderConfig;
  resolvePath?: (activeChatProvider?: LlmProviderConfig) => Promise<ResolvedConsolidationPath>;
}

export async function resolveConsolidationExtractor(
  input: ResolveConsolidationExtractorInput = {},
): Promise<ConsolidatorExtractor | undefined> {
  const resolvePath = input.resolvePath ?? resolveConsolidationPath;
  const path = await resolvePath(input.activeChatProvider);
  return path.extractor ?? undefined;
}

export type ProcessConsolidationTurnInput = Omit<ProcessTurnInput, 'extractor'> & {
  extractor?: ConsolidatorExtractor | null;
  activeChatProvider?: LlmProviderConfig;
  resolvePath?: (activeChatProvider?: LlmProviderConfig) => Promise<ResolvedConsolidationPath>;
};

export async function processConsolidationTurn(
  input: ProcessConsolidationTurnInput,
): Promise<ProcessTurnResult> {
  const { extractor: providedExtractor, activeChatProvider, resolvePath, ...turnInput } = input;
  const extractor =
    providedExtractor === null
      ? undefined
      : (providedExtractor ??
        (await resolveConsolidationExtractor({ activeChatProvider, resolvePath })));

  return processIngestionTurn({
    ...turnInput,
    ...(extractor ? { extractor } : {}),
  });
}
