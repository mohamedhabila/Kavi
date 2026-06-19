// ---------------------------------------------------------------------------
// Kavi — Goal-Aware Tool Surface
// ---------------------------------------------------------------------------
// Resolves which tools are exposed for a model turn using structural graph
// signals only: async monitors, goal capabilities, discovery activation, and
// workflow continuation.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import {
  normalizeToolWorkflowContract,
  workflowProductionSatisfiesConsumption,
} from '../tools/toolWorkflowContracts';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { GOAL_BOOTSTRAP_TOOL_NAME } from './bootstrap';
import { resolveSuccessCriterionSurfaceHints } from './completionEvidence';
import type { AgentGoal } from './types';

export const DEFAULT_CORE_TOOL_ORDER = [
  GOAL_BOOTSTRAP_TOOL_NAME,
  'memory_recall',
  'memory_remember',
  'read_file',
  'write_file',
  'list_files',
] as const;

const STABLE_TOOL_SURFACE_ORDER_VALUES = [
  GOAL_BOOTSTRAP_TOOL_NAME,
  'memory_recall',
  'memory_remember',
  'read_file',
  'write_file',
  'sessions_spawn',
  'sessions_wait',
  'list_files',
  'file_edit',
  'glob_search',
  'text_search',
  'web_search',
  'web_fetch',
] as const;

export const DEFAULT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
  DEFAULT_CORE_TOOL_ORDER,
);
const STABLE_TOOL_SURFACE_ORDER = new Map(
  [...STABLE_TOOL_SURFACE_ORDER_VALUES, 'tool_catalog', 'tool_describe'].map(
    (name, index) => [name, index],
  ),
);

const GOAL_CAPABILITY_EXCLUDED_TOOL_NAMES = new Set(['tool_catalog', 'tool_describe']);
type PromptCachePlacement = Exclude<
  NonNullable<ToolDefinition['promptCache']>['placement'],
  undefined
>;

function normalizeTagList(values: ReadonlyArray<string> | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function hasAnySuccessCriterionSurfaceHints(goal: AgentGoal): boolean {
  return (goal.successCriteria ?? []).some((criterion) => {
    const hints = resolveSuccessCriterionSurfaceHints(criterion);
    return (
      hints.toolNames.length > 0 ||
      hints.capabilities.length > 0 ||
      hints.resourceKinds.length > 0 ||
      hints.categories.length > 0
    );
  });
}

function hasRequiredResourceKinds(goal: AgentGoal): boolean {
  return normalizeTagList(goal.requiredResourceKinds).length > 0;
}

function isCodeExecutionTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  return tool?.contract?.category === 'code';
}

function isSideEffectfulTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  const sideEffects = tool?.contract?.sideEffects ?? [];
  return sideEffects.some((sideEffect) => sideEffect !== 'none');
}

function isMemoryResourceTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  return (tool?.contract?.resourceKinds ?? []).includes('memory');
}

function isDefaultMobileDiscoveryTool(tool: Pick<ToolDefinition, 'contract'> | undefined): boolean {
  const contract = tool?.contract;
  const workflowContract = normalizeToolWorkflowContract(contract);
  if (!normalizeTagList(contract?.resourceKinds).includes('device')) {
    return false;
  }
  const sideEffects = normalizeTagList(contract?.sideEffects);
  if (sideEffects.length > 0 && !sideEffects.every((sideEffect) => sideEffect === 'none')) {
    return false;
  }
  if (workflowContract.consumes.some((consumption) => consumption.required !== false)) {
    return false;
  }
  const capabilities = normalizeTagList(contract?.capabilities);
  const workflowStages = normalizeTagList(contract?.workflowStages);
  return (
    capabilities.includes('discover') ||
    workflowStages.includes('discover_resource') ||
    (capabilities.includes('read') && workflowContract.produces.length > 0)
  );
}

function collectCompletedGoalEvidenceToolNames(
  goals: ReadonlyArray<AgentGoal>,
  toolByName: ReadonlyMap<string, ToolDefinition>,
): string[] {
  const toolNames = new Set<string>();
  for (const goal of goals) {
    if (goal.status !== 'completed') {
      continue;
    }
    for (const evidence of goal.evidence) {
      const separatorIndex = evidence.indexOf(':');
      if (separatorIndex <= 0) {
        continue;
      }
      const toolName = normalizeToolName(evidence.slice(0, separatorIndex));
      if (toolName && toolByName.has(toolName)) {
        toolNames.add(toolName);
      }
    }
  }
  return Array.from(toolNames);
}

function withPromptCachePlacement(
  tool: ToolDefinition,
  placement: PromptCachePlacement,
): ToolDefinition {
  if (tool.promptCache?.placement === placement) {
    return tool;
  }
  return {
    ...tool,
    promptCache: {
      ...tool.promptCache,
      placement,
    },
  };
}

function prunePrematureWorkflowConsumers(params: {
  selectedNames: Set<string>;
  toolByName: ReadonlyMap<string, ToolDefinition>;
  observedToolNames: ReadonlySet<string>;
}): void {
  const observedProductions = Array.from(params.observedToolNames).flatMap((toolName) =>
    normalizeToolWorkflowContract(params.toolByName.get(toolName)?.contract).produces,
  );
  const selectedProducers = Array.from(params.selectedNames).flatMap((toolName) => {
    const contract = normalizeToolWorkflowContract(params.toolByName.get(toolName)?.contract);
    return contract.produces.map((production) => ({ toolName, production }));
  });

  for (const toolName of Array.from(params.selectedNames)) {
    const requiredConsumptions = normalizeToolWorkflowContract(
      params.toolByName.get(toolName)?.contract,
    ).consumes.filter((consumption) => consumption.required !== false);
    if (requiredConsumptions.length === 0) {
      continue;
    }

    const unsatisfiedRequiredConsumptions = requiredConsumptions.filter(
      (consumption) =>
        !observedProductions.some((production) =>
          workflowProductionSatisfiesConsumption(production, consumption),
        ),
    );
    if (unsatisfiedRequiredConsumptions.length === 0) {
      continue;
    }

    const hasSelectedUpstreamProducer = unsatisfiedRequiredConsumptions.some((consumption) =>
      selectedProducers.some(
        ({ toolName: producerName, production }) =>
          producerName !== toolName &&
          workflowProductionSatisfiesConsumption(production, consumption),
      ),
    );
    if (hasSelectedUpstreamProducer) {
      params.selectedNames.delete(toolName);
    }
  }
}

function shouldAcceptContinuationTool(params: {
  toolName: string;
  toolByName: ReadonlyMap<string, ToolDefinition>;
  resourceScopedGoalCapabilityToolNames: ReadonlySet<string>;
  completedResourceScopedGoalCapabilityToolNames: ReadonlySet<string>;
  completedGoalEvidenceToolNames: ReadonlySet<string>;
  completedWorkflowToolNames: ReadonlySet<string>;
  allowUnownedSideEffectfulTool?: boolean;
}): boolean {
  const tool = params.toolByName.get(params.toolName);
  if (
    !isMemoryResourceTool(tool) &&
    !params.resourceScopedGoalCapabilityToolNames.has(params.toolName) &&
    params.completedWorkflowToolNames.has(params.toolName)
  ) {
    return false;
  }

  if (
    isSideEffectfulTool(tool) &&
    !isMemoryResourceTool(tool) &&
    !params.resourceScopedGoalCapabilityToolNames.has(params.toolName)
  ) {
    return (
      params.allowUnownedSideEffectfulTool === true &&
      !params.completedResourceScopedGoalCapabilityToolNames.has(params.toolName) &&
      !params.completedGoalEvidenceToolNames.has(params.toolName) &&
      !params.completedWorkflowToolNames.has(params.toolName)
    );
  }
  return true;
}

export function resolveOrderedGoalCapabilities(capabilities: ReadonlyArray<string>): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    const normalized = capability.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

export function resolveGoalCapabilityToolNames(
  goals: ReadonlyArray<AgentGoal>,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>,
): string[] {
  return resolveGoalCapabilityToolNamesForGoals(goals, tools);
}

function resolveResourceScopedGoalCapabilityToolNames(
  goals: ReadonlyArray<AgentGoal>,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>,
): string[] {
  return Array.from(
    new Set([
      ...resolveGoalCapabilityToolNamesForGoals(goals.filter(hasRequiredResourceKinds), tools),
      ...resolveSuccessCriterionToolNamesForGoals(
        goals.filter(hasAnySuccessCriterionSurfaceHints),
        tools,
      ),
    ]),
  );
}

function resolveCompletedResourceScopedGoalCapabilityToolNames(
  goals: ReadonlyArray<AgentGoal>,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>,
): string[] {
  return Array.from(
    new Set([
      ...resolveGoalCapabilityToolNamesForGoals(
        goals.filter((goal) => goal.status === 'completed' && hasRequiredResourceKinds(goal)),
        tools,
        new Set<AgentGoal['status']>(['completed']),
      ),
      ...resolveSuccessCriterionToolNamesForGoals(
        goals.filter(
          (goal) => goal.status === 'completed' && hasAnySuccessCriterionSurfaceHints(goal),
        ),
        tools,
        new Set<AgentGoal['status']>(['completed']),
      ),
    ]),
  );
}

function matchesSuccessCriterionSurfaceHints(
  tool: Pick<ToolDefinition, 'name' | 'contract'>,
  criterion: string,
): boolean {
  const normalizedName = normalizeToolName(tool.name);
  if (!normalizedName || GOAL_CAPABILITY_EXCLUDED_TOOL_NAMES.has(normalizedName)) {
    return false;
  }

  const hints = resolveSuccessCriterionSurfaceHints(criterion);
  const normalizedHintToolNames = hints.toolNames.map((toolName) => normalizeToolName(toolName));
  if (normalizedHintToolNames.includes(normalizedName)) {
    return true;
  }

  if (
    hints.capabilities.length === 0 &&
    hints.resourceKinds.length === 0 &&
    hints.categories.length === 0
  ) {
    return false;
  }

  if (isCodeExecutionTool(tool)) {
    return false;
  }

  const category = tool.contract?.category?.trim();
  if (hints.categories.length > 0 && (!category || !hints.categories.includes(category))) {
    return false;
  }

  const capabilities = normalizeTagList(tool.contract?.capabilities);
  if (
    hints.capabilities.length > 0 &&
    !capabilities.some((capability) => hints.capabilities.includes(capability))
  ) {
    return false;
  }

  const resourceKinds = normalizeTagList(tool.contract?.resourceKinds);
  if (
    hints.resourceKinds.length > 0 &&
    !resourceKinds.some((resourceKind) => hints.resourceKinds.includes(resourceKind))
  ) {
    return false;
  }

  return true;
}

function resolveSuccessCriterionToolNamesForGoals(
  goals: ReadonlyArray<AgentGoal>,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>,
  eligibleStatuses: ReadonlySet<AgentGoal['status']> = new Set<AgentGoal['status']>([
    'active',
    'pending',
    'blocked',
  ]),
): string[] {
  const liveGoals = goals.filter((goal) => eligibleStatuses.has(goal.status));
  if (liveGoals.length === 0) {
    return [];
  }

  return tools
    .filter((tool) =>
      liveGoals.some((goal) =>
        (goal.successCriteria ?? []).some((criterion) =>
          matchesSuccessCriterionSurfaceHints(tool, criterion),
        ),
      ),
    )
    .map((tool) => normalizeToolName(tool.name))
    .filter(Boolean);
}

function resolveGoalCapabilityToolNamesForGoals(
  goals: ReadonlyArray<AgentGoal>,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>,
  eligibleStatuses: ReadonlySet<AgentGoal['status']> = new Set<AgentGoal['status']>([
    'active',
    'pending',
    'blocked',
  ]),
): string[] {
  const liveGoals = goals.filter((goal) => eligibleStatuses.has(goal.status));
  if (liveGoals.length === 0) {
    return [];
  }

  const capabilityToolNames = tools
    .filter((tool) => {
      const normalizedName = normalizeToolName(tool.name);
      if (!normalizedName || GOAL_CAPABILITY_EXCLUDED_TOOL_NAMES.has(normalizedName)) {
        return false;
      }
      const capabilities = tool.contract?.capabilities ?? [];
      const resourceKinds = tool.contract?.resourceKinds ?? [];

      return liveGoals.some((goal) => {
        const requiredCapabilities = normalizeTagList(goal.requiredCapabilities);
        if (requiredCapabilities.length === 0) {
          return false;
        }
        const capabilityMatch = capabilities.some((capability) =>
          requiredCapabilities.includes(capability),
        );
        if (!capabilityMatch) {
          return false;
        }

        const requiredResourceKinds = normalizeTagList(goal.requiredResourceKinds);
        if (requiredResourceKinds.length === 0) {
          return true;
        }
        return resourceKinds.some((resourceKind) => requiredResourceKinds.includes(resourceKind));
      });
    })
    .map((tool) => normalizeToolName(tool.name))
    .filter(Boolean);

  return Array.from(
    new Set([
      ...capabilityToolNames,
      ...resolveSuccessCriterionToolNamesForGoals(liveGoals, tools, eligibleStatuses),
    ]),
  );
}

export interface ResolveTurnToolSurfaceParams {
  allTools: ReadonlyArray<ToolDefinition>;
  goals: ReadonlyArray<AgentGoal>;
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  observedToolNames: Iterable<string>;
  recentContinuationToolNames: ReadonlySet<string>;
  workflowContinuationToolNames?: ReadonlySet<string>;
  activatedCatalogToolNames: ReadonlySet<string>;
  unresolvedDiscoveryToolCallInTurn?: boolean;
  includeToolCatalog?: boolean;
}

export function resolveTurnToolSurface(params: ResolveTurnToolSurfaceParams): ToolDefinition[] {
  const selectedNames = new Set<string>();
  const stablePrefixToolNames = new Set<string>();
  const toolByName = new Map(
    params.allTools
      .map((tool): [string, ToolDefinition] => [normalizeToolName(tool.name), tool])
      .filter(([toolName]) => Boolean(toolName)),
  );

  for (const toolName of DEFAULT_CORE_TOOL_NAMES) {
    selectedNames.add(toolName);
    stablePrefixToolNames.add(toolName);
  }

  for (const [toolName, tool] of toolByName) {
    if (isDefaultMobileDiscoveryTool(tool)) {
      selectedNames.add(toolName);
      stablePrefixToolNames.add(toolName);
    }
  }

  for (const toolName of params.pendingAsyncMonitorToolNames) {
    const normalized = normalizeToolName(toolName);
    if (normalized) {
      selectedNames.add(normalized);
    }
  }

  for (const toolName of params.explicitToolSurfaceToolNames ?? []) {
    const normalized = normalizeToolName(toolName);
    if (normalized) {
      selectedNames.add(normalized);
      stablePrefixToolNames.add(normalized);
    }
  }

  const goalCapabilityToolNames = resolveGoalCapabilityToolNames(params.goals, params.allTools);
  const resourceScopedGoalCapabilityToolNames = new Set(
    resolveResourceScopedGoalCapabilityToolNames(params.goals, params.allTools),
  );
  const completedResourceScopedGoalCapabilityToolNames = new Set(
    resolveCompletedResourceScopedGoalCapabilityToolNames(params.goals, params.allTools),
  );
  const completedGoalEvidenceToolNames = new Set(
    collectCompletedGoalEvidenceToolNames(params.goals, toolByName),
  );
  const completedWorkflowToolNames = new Set(
    Array.from(params.observedToolNames)
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );

  for (const toolName of goalCapabilityToolNames) {
    selectedNames.add(toolName);
  }

  for (const normalized of completedWorkflowToolNames) {
    if (
      normalized &&
      shouldAcceptContinuationTool({
        toolName: normalized,
        toolByName,
        resourceScopedGoalCapabilityToolNames,
        completedResourceScopedGoalCapabilityToolNames,
        completedGoalEvidenceToolNames,
        completedWorkflowToolNames,
      })
    ) {
      selectedNames.add(normalized);
    }
  }

  for (const toolName of params.recentContinuationToolNames) {
    if (
      shouldAcceptContinuationTool({
        toolName,
        toolByName,
        resourceScopedGoalCapabilityToolNames,
        completedResourceScopedGoalCapabilityToolNames,
        completedGoalEvidenceToolNames,
        completedWorkflowToolNames,
        allowUnownedSideEffectfulTool:
          params.workflowContinuationToolNames?.has(toolName) === true,
      })
    ) {
      selectedNames.add(toolName);
    }
  }

  for (const toolName of params.activatedCatalogToolNames) {
    if (
      shouldAcceptContinuationTool({
        toolName,
        toolByName,
        resourceScopedGoalCapabilityToolNames,
        completedResourceScopedGoalCapabilityToolNames,
        completedGoalEvidenceToolNames,
        completedWorkflowToolNames,
        allowUnownedSideEffectfulTool: true,
      })
    ) {
      selectedNames.add(toolName);
    }
  }

  const hasActivatedCatalogTools = params.activatedCatalogToolNames.size > 0;
  const shouldExposeDiscoveryTools =
    params.unresolvedDiscoveryToolCallInTurn === true ||
    hasActivatedCatalogTools ||
    (!hasActivatedCatalogTools &&
      (params.includeToolCatalog ||
        params.recentContinuationToolNames.has('tool_catalog') ||
        params.recentContinuationToolNames.has('tool_describe')));

  if (shouldExposeDiscoveryTools) {
    selectedNames.add('tool_catalog');
    selectedNames.add('tool_describe');
    stablePrefixToolNames.add('tool_catalog');
    stablePrefixToolNames.add('tool_describe');
  }

  prunePrematureWorkflowConsumers({
    selectedNames,
    toolByName,
    observedToolNames: new Set([
      ...completedWorkflowToolNames,
      ...params.recentContinuationToolNames,
    ]),
  });

  return orderTurnToolSurface(
    params.allTools.filter((tool) => selectedNames.has(normalizeToolName(tool.name))),
  ).map((tool) => {
    const normalizedName = normalizeToolName(tool.name);
    return withPromptCachePlacement(
      tool,
      stablePrefixToolNames.has(normalizedName) ? 'stable_prefix' : 'dynamic_suffix',
    );
  });
}

function orderTurnToolSurface(tools: ReadonlyArray<ToolDefinition>): ToolDefinition[] {
  return [...tools].sort((left, right) => {
    const leftName = normalizeToolName(left.name);
    const rightName = normalizeToolName(right.name);
    const leftOrder = STABLE_TOOL_SURFACE_ORDER.get(leftName);
    const rightOrder = STABLE_TOOL_SURFACE_ORDER.get(rightName);

    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return leftName.localeCompare(rightName);
  });
}
