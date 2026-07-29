import type { LlmProviderConfig } from '../../../types/provider';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
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

export type ConsolidationExecutionResource = 'deterministic' | 'on_device' | 'remote' | 'unknown';

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
  onExecutionResourceResolved?: (resource: ConsolidationExecutionResource) => void;
};

export async function processConsolidationTurn(
  input: ProcessConsolidationTurnInput,
): Promise<ProcessTurnResult> {
  const {
    extractor: providedExtractor,
    activeChatProvider,
    requireExplicitChatProvider,
    resolvePath,
    onExecutionResourceResolved,
    ...turnInput
  } = input;
  let extractor: ConsolidatorExtractor | undefined;
  let executionResource: ConsolidationExecutionResource;
  if (providedExtractor === null) {
    executionResource = 'deterministic';
  } else if (providedExtractor) {
    extractor = providedExtractor;
    executionResource = 'unknown';
  } else {
    const path = await (resolvePath ?? resolveConsolidationPath)(activeChatProvider, {
      requireExplicitChatProvider,
    });
    extractor = path.extractor ?? undefined;
    executionResource = !extractor
      ? 'deterministic'
      : isOnDeviceLlmProvider(path.provider)
        ? 'on_device'
        : 'remote';
  }
  onExecutionResourceResolved?.(executionResource);

  return processIngestionTurn({
    ...turnInput,
    ...(extractor ? { extractor } : {}),
  });
}
