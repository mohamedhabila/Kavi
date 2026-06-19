import type { AgentGoal } from '../../types/agentRun';
import type { ToolDefinition } from '../../types/tool';
import { resolveGoalsPromptSectionForTurn } from '../goals/promptSection';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { estimateAllToolTokens } from '../tools/toolManagerTokenBudget';
import {
  buildAgentTurnPromptBundle,
  type AgentTurnPromptBundleParams,
} from './agentTurnPromptBundle';
import { isSessionCoordinationToolName } from '../tools/sessionToolKinds';

type PromptBundleContext = Omit<
  AgentTurnPromptBundleParams,
  'selectedTools' | 'effectiveForceTextThisTurn' | 'toolingEnabledForProvider'
> & {
  graphGoals?: ReadonlyArray<AgentGoal>;
};

export interface PrepareAgentTurnParams {
  allowSessionCoordinationTools: boolean;
  effectiveForceTextThisTurn: boolean;
  groundedRequestScopedTools: ReadonlyArray<ToolDefinition>;
  pinnedToolNames?: ReadonlyArray<string>;
  promptBundleContext: PromptBundleContext;
  toolingEnabledForProvider: boolean;
}

export interface PreparedAgentTurn {
  enrichedSystemPrompt: string;
  enrichedSystemPromptSections: ReturnType<
    typeof buildAgentTurnPromptBundle
  >['enrichedSystemPromptSections'];
  pinnedToolNames: string[];
  selectedToolTokenEstimate: number;
  selectedTools: ToolDefinition[];
  toolsForIteration: ToolDefinition[] | undefined;
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
  const selectedToolNames = new Set(
    selectedTools.map((tool) => normalizeToolName(tool.name)).filter(Boolean),
  );
  const goalsPromptSection = params.promptBundleContext.graphGoals
    ? resolveGoalsPromptSectionForTurn({
        goals: params.promptBundleContext.graphGoals,
        selectedToolNames,
      })
    : params.promptBundleContext.goalsPromptSection;
  const promptBundle = buildAgentTurnPromptBundle({
    ...params.promptBundleContext,
    goalsPromptSection,
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
    }),
    selectedTools,
    toolsForIteration: promptBundle.toolsForIteration,
  };
}
