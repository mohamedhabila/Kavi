import type { LlmProviderConfig } from '../../../types/provider';
import type { ConsolidatorExtractor } from '../consolidator';
import {
  processIngestionTurn,
  type ProcessTurnInput,
  type ProcessTurnResult,
} from '../turnProcessor';
import {
  resolveConsolidationPath,
  type ConsolidationPathOptions,
  type ResolvedConsolidationPath,
} from './paths';

type ResolveConsolidationPath = (
  activeChatProvider?: LlmProviderConfig,
  options?: ConsolidationPathOptions,
) => Promise<ResolvedConsolidationPath>;

export interface ResolveConsolidationExtractorInput {
  activeChatProvider?: LlmProviderConfig;
  requireExplicitChatProvider?: boolean;
  resolvePath?: ResolveConsolidationPath;
}

export async function resolveConsolidationExtractor(
  input: ResolveConsolidationExtractorInput = {},
): Promise<ConsolidatorExtractor | undefined> {
  const resolvePath = input.resolvePath ?? resolveConsolidationPath;
  const path = await resolvePath(input.activeChatProvider, {
    requireExplicitChatProvider: input.requireExplicitChatProvider,
  });
  return path.extractor ?? undefined;
}

export type ProcessConsolidationTurnInput = Omit<ProcessTurnInput, 'extractor'> & {
  extractor?: ConsolidatorExtractor | null;
  activeChatProvider?: LlmProviderConfig;
  requireExplicitChatProvider?: boolean;
  resolvePath?: ResolveConsolidationPath;
};

export async function processConsolidationTurn(
  input: ProcessConsolidationTurnInput,
): Promise<ProcessTurnResult> {
  const {
    extractor: providedExtractor,
    activeChatProvider,
    requireExplicitChatProvider,
    resolvePath,
    ...turnInput
  } = input;
  const extractor =
    providedExtractor === null
      ? undefined
      : (providedExtractor ??
        (await resolveConsolidationExtractor({
          activeChatProvider,
          requireExplicitChatProvider,
          resolvePath,
        })));

  return processIngestionTurn({
    ...turnInput,
    ...(extractor ? { extractor } : {}),
  });
}
