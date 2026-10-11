import type { ToolDefinition } from '../../types/tool';
import { estimateAllToolTokens } from '../tools/toolManagerTokenBudget';
import {
  buildAgentTurnPromptBundle,
  type AgentTurnPromptBundleParams,
} from './agentTurnPromptBundle';
import { isSessionCoordinationToolName } from '../tools/sessionToolKinds';
import type { VerifiedProcedureAuthoritySnapshot } from '../../services/memory/verifiedProcedure/observationAuthority';
import type { MemoryAuthoritySnapshot } from '../../services/memory/memoryAuthority';

type PromptBundleContext = Omit<
  AgentTurnPromptBundleParams,
  'selectedTools' | 'effectiveForceTextThisTurn' | 'toolingEnabledForProvider'
>;

export interface PrepareAgentTurnParams {
  allowSessionCoordinationTools: boolean;
  effectiveForceTextThisTurn: boolean;
  /** Provider family for the online token-calibration EMA (see `tokenCounter.ts`). */
  family?: string;
  groundedRequestScopedTools: ReadonlyArray<ToolDefinition>;
  pinnedToolNames?: ReadonlyArray<string>;
  promptBundleContext: PromptBundleContext;
  toolingEnabledForProvider: boolean;
}

export interface PreparedAgentTurnCore {
  enrichedSystemPrompt: string;
  enrichedSystemPromptSections: ReturnType<
    typeof buildAgentTurnPromptBundle
  >['enrichedSystemPromptSections'];
  pinnedToolNames: string[];
  selectedToolTokenEstimate: number;
  selectedTools: ToolDefinition[];
  toolsForIteration: ToolDefinition[] | undefined;
}

export interface PreparedAgentTurn extends PreparedAgentTurnCore {
  memoryReadFence?: {
    readEpoch: number;
    memoryAuthoritySnapshot: MemoryAuthoritySnapshot;
    validUntil?: number;
    verifiedProcedureAuthoritySnapshot?: VerifiedProcedureAuthoritySnapshot;
  };
}

export function prepareAgentTurn(params: PrepareAgentTurnParams): PreparedAgentTurn {
  const selectedTools =
    !params.toolingEnabledForProvider || params.effectiveForceTextThisTurn
      ? []
      : params.groundedRequestScopedTools.filter((tool) => {
          if (!params.allowSessionCoordinationTools && isSessionCoordinationToolName(tool.name)) {
            return false;
          }
          return true;
        });
  const promptBundle = buildAgentTurnPromptBundle({
    ...params.promptBundleContext,
    effectiveForceTextThisTurn: params.effectiveForceTextThisTurn,
    selectedTools,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
  });

  const pinnedToolNames = Array.from(
    new Set((params.pinnedToolNames ?? []).map((name) => name.trim()).filter(Boolean)),
  );

  return {
    enrichedSystemPrompt: promptBundle.enrichedSystemPrompt,
    enrichedSystemPromptSections: promptBundle.enrichedSystemPromptSections,
    pinnedToolNames,
    selectedToolTokenEstimate: estimateAllToolTokens(selectedTools, {
      pinnedToolNames: new Set(pinnedToolNames),
      family: params.family,
    }),
    selectedTools,
    toolsForIteration: promptBundle.toolsForIteration,
  };
}
