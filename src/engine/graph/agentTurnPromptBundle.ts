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
import {
  renderWorkflowTaskAnchorPromptSection,
  type WorkflowTaskAnchor,
} from './workflowTaskAnchor';

type LivingMemorySection = {
  text: string;
  cacheable?: boolean;
};

export interface AgentTurnPromptBundleParams {
  effectiveForceTextThisTurn: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlGraphForcedTextReason;
  goalsPromptSection?: string | null;
  groundedRequestScopedTools: ReadonlyArray<ToolDefinition>;
  iteration: number;
  livingMemorySections?: ReadonlyArray<LivingMemorySection>;
  maxToolIterations: number;
  resolvedPrompt: string;
  runtimeContext?: string | null;
  runtimePolicyPrompt?: string | null;
  selectedTools: ToolDefinition[];
  skillPrompts: string;
  toolingEnabledForProvider: boolean;
  workflowRuntimePrompt?: string | null;
  workflowTaskAnchor?: WorkflowTaskAnchor;
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
    params.skillPrompts,
    params.workflowRuntimePrompt ?? '',
    params.toolingEnabledForProvider,
    textOnlyPrompt,
  );
  appendSystemPromptSection(baseSystemPromptSections, params.runtimePolicyPrompt, {
    purpose: 'memory_policy',
  });
  for (const section of params.livingMemorySections ?? []) {
    appendSystemPromptSection(baseSystemPromptSections, section.text, {
      cacheable: section.cacheable === true,
      purpose: 'living_memory',
    });
  }
  appendSystemPromptSection(
    baseSystemPromptSections,
    params.workflowTaskAnchor
      ? renderWorkflowTaskAnchorPromptSection(params.workflowTaskAnchor)
      : null,
    { purpose: 'workflow_task_anchor' },
  );
  appendSystemPromptSection(baseSystemPromptSections, params.goalsPromptSection, {
    purpose: 'goals',
  });
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
          purpose: 'forced_text',
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
