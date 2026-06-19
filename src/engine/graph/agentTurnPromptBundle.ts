import type { ToolDefinition } from '../../types/tool';
import {
  appendSystemPromptSection,
  buildSystemPromptSections,
  joinSystemPromptSections,
  orderSystemPromptSectionsForCaching,
  type SystemPromptSection,
} from '../prompts/orchestratorPromptSections';
import type { AgentControlGraphForcedTextReason } from './forcedTextTurn';
import { buildAgentControlGraphForcedTextOnlyTurnPrompt } from './forcedTextTurn';

type LivingMemorySection = {
  text: string;
  cacheable?: boolean;
};

export interface AgentTurnPromptBundleParams {
  conversationMemory: string | null;
  effectiveForceTextThisTurn: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlGraphForcedTextReason;
  goalsPromptSection?: string | null;
  globalMemory: string | null;
  groundedRequestScopedTools: ReadonlyArray<ToolDefinition>;
  iteration: number;
  livingMemorySections?: ReadonlyArray<LivingMemorySection>;
  maxToolIterations: number;
  resolvedPrompt: string;
  runtimeContext?: string | null;
  selectedTools: ToolDefinition[];
  skillPrompts: string;
  toolingEnabledForProvider: boolean;
}

export interface AgentTurnPromptBundle {
  enrichedSystemPrompt: string;
  enrichedSystemPromptSections: SystemPromptSection[];
  toolsForIteration: ToolDefinition[] | undefined;
}

export function buildAgentTurnPromptBundle(
  params: AgentTurnPromptBundleParams,
): AgentTurnPromptBundle {
  const toolsForIteration =
    params.toolingEnabledForProvider &&
    !params.effectiveForceTextThisTurn &&
    params.iteration <= params.maxToolIterations - 1
      ? params.selectedTools
      : undefined;
  const textOnlyPrompt = params.effectiveForceTextThisTurn || params.selectedTools.length === 0;
  const baseSystemPromptSections = buildSystemPromptSections(
    params.resolvedPrompt,
    params.runtimeContext ?? null,
    params.conversationMemory,
    params.globalMemory,
    params.skillPrompts,
    '',
    params.toolingEnabledForProvider,
    textOnlyPrompt,
  );
  for (const section of params.livingMemorySections ?? []) {
    appendSystemPromptSection(baseSystemPromptSections, section.text, {
      cacheable: section.cacheable === true,
    });
  }
  appendSystemPromptSection(baseSystemPromptSections, params.goalsPromptSection);
  const orderedBaseSystemPromptSections =
    orderSystemPromptSectionsForCaching(baseSystemPromptSections);
  const baseSystemPrompt = joinSystemPromptSections(orderedBaseSystemPromptSections);
  const enrichedSystemPromptSections = params.effectiveForceTextThisTurn
    ? orderSystemPromptSectionsForCaching([
        ...orderedBaseSystemPromptSections,
        {
          text: buildAgentControlGraphForcedTextOnlyTurnPrompt(
            params.effectiveForceTextReasonThisTurn,
          ),
          cacheable: false,
        },
      ])
    : orderedBaseSystemPromptSections;
  const enrichedSystemPrompt = params.effectiveForceTextThisTurn
    ? joinSystemPromptSections(enrichedSystemPromptSections)
    : baseSystemPrompt;

  return {
    enrichedSystemPrompt,
    enrichedSystemPromptSections,
    toolsForIteration,
  };
}
