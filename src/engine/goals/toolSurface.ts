// ---------------------------------------------------------------------------
// Kavi — Goal-Aware Tool Surface
// ---------------------------------------------------------------------------
// Resolves which tools are exposed for a model turn using structural graph
// signals only: async monitors, goal capabilities, discovery activation, and
// workflow continuation.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import type { ConversationMode } from '../../types/conversation';
import {
  normalizeToolWorkflowContract,
  workflowProductionSatisfiesConsumption,
} from '../tools/toolWorkflowContracts';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { GOAL_BOOTSTRAP_TOOL_NAME } from './bootstrap';
import { resolveSuccessCriterionSurfaceHints } from './completionEvidence';
import type { AgentGoal } from './types';
import {
  collectCompletedGoalEvidenceToolNames,
  isCodeExecutionTool,
  isRepeatableActivatedTool,
  shouldAcceptContinuationTool,
} from './toolSurfaceRetention';
import { isChitchatAuthorizedTool } from './toolSurfaceAuthority';
import { REQUEST_CLARIFICATION_TOOL_NAME } from '../../services/agents/requestClarification';

/**
 * Turn-1 surface for a general mobile assistant. Discovery still gates the long tail,
 * but the everyday read paths a phone assistant needs most — web lookup plus read-only
 * calendar, contacts, location, and device state — are present from the first turn so
 * an ordinary request does not cost a `tool_catalog` round-trip before it can start.
 * Every promoted native tool is read-only; mutations stay behind discovery and approval.
 */
export const DEFAULT_CORE_TOOL_ORDER = [
  REQUEST_CLARIFICATION_TOOL_NAME,
  GOAL_BOOTSTRAP_TOOL_NAME,
  'memory_recall',
  'memory_remember',
  'memory_preserve_source',
  'memory_forget',
  'read_file',
  'write_file',
  'list_files',
  'sessions_spawn',
  'wait',
  'cron',
  'reminder',
  'web_search',
  'web_fetch',
  'calendar_events',
  'contacts_search',
  'location_current',
  'device_query',
] as const;

const STABLE_TOOL_SURFACE_ORDER_VALUES = [
  REQUEST_CLARIFICATION_TOOL_NAME,
  GOAL_BOOTSTRAP_TOOL_NAME,
  'memory_recall',
  'memory_remember',
  'memory_preserve_source',
  'memory_forget',
  'read_file',
  'write_file',
  'sessions_spawn',
  'sessions_wait',
  'wait',
  'list_files',
  'cron',
  'reminder',
  'file_edit',
  'glob_search',
  'text_search',
  'web_search',
  'web_fetch',
  'calendar_events',
  'calendar_create_event',
  'contacts_search',
  'contacts_pick',
  'email_compose',
  'sms_compose',
  'phone_call',
  'maps_open',
  'share',
  'clipboard',
  'photos_pick',
  'location_current',
  'device_query',
  'notification_send',
] as const;

export const DEFAULT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
  DEFAULT_CORE_TOOL_ORDER,
);
/**
 * Turn-1 *disclosure* order for chitchat, not authority — whether one of these names
 * can actually be called is decided entirely by `resolveAuthorizedToolNames` below.
 * This is the everyday-action set a general mobile assistant reaches for on an
 * ordinary first turn: clarification, grounded memory, web lookup, and the native
 * capabilities a phone assistant is asked for most (calendar, contacts, messaging,
 * maps, sharing, device state) — present immediately so none of them costs a
 * `tool_catalog` round-trip before the turn can start. A name not registered at
 * runtime (`reminder`, until it ships) is simply never matched when the surface is
 * built from `allTools`, so listing it here ahead of its registration is inert.
 */
const CHITCHAT_DEFAULT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  REQUEST_CLARIFICATION_TOOL_NAME,
  'memory_recall',
  'memory_remember',
  'memory_preserve_source',
  'memory_forget',
  'web_search',
  'web_fetch',
  'reminder',
  'calendar_events',
  'calendar_create_event',
  'contacts_search',
  'contacts_pick',
  'email_compose',
  'sms_compose',
  'phone_call',
  'maps_open',
  'share',
  'clipboard',
  'photos_pick',
  'location_current',
  'device_query',
  'notification_send',
]);
const STABLE_TOOL_SURFACE_ORDER = new Map(
  [...STABLE_TOOL_SURFACE_ORDER_VALUES, 'tool_catalog', 'tool_describe'].map((name, index) => [
    name,
    index,
  ]),
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
  const observedProductions = Array.from(params.observedToolNames).flatMap(
    (toolName) => normalizeToolWorkflowContract(params.toolByName.get(toolName)?.contract).produces,
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
        if (isCodeExecutionTool(tool) && !requiredCapabilities.includes('compute')) {
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
          // Broad verbs such as "read" and "write" do not identify a resource
          // domain. Keep those goals on the core workbench and catalog instead
          // of activating every matching device or integration tool. Compute is
          // the narrow exception because code execution is already isolated as
          // its own category and explicitly gated above.
          return isCodeExecutionTool(tool) && requiredCapabilities.includes('compute');
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
  conversationMode?: ConversationMode;
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

  const defaultCoreToolNames =
    params.conversationMode === 'chitchat'
      ? CHITCHAT_DEFAULT_CORE_TOOL_NAMES
      : DEFAULT_CORE_TOOL_NAMES;
  for (const toolName of defaultCoreToolNames) {
    selectedNames.add(toolName);
    stablePrefixToolNames.add(toolName);
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
        allowUnownedSideEffectfulTool: params.workflowContinuationToolNames?.has(toolName) === true,
      })
    ) {
      selectedNames.add(toolName);
    }
  }

  /**
   * An explicit catalog activation of a repeatable capability is durable for the run.
   *
   * Activation used to be re-litigated every turn against the same completion sets that
   * govern incidental continuation, waived only for `mcp__`/`skill__` names. Every other
   * discovered tool was therefore evicted by its own first success — and because the
   * eviction keys off having been observed, re-running `tool_catalog` could not restore
   * it. The off-surface refusal names `tool_catalog` as the recovery, so the run was told
   * to take a step that provably could not work.
   *
   * Traced on-device: a feasibility study needing Monte Carlo activated `python`, ran it
   * once, and could never call it again. It alternated rejected `python` calls and
   * useless `tool_catalog` calls until the iteration budget ran out. The run failed with
   * no legal move available to it.
   *
   * Eviction still holds for a pure mutator, where a second call means a second effect
   * and the tool has nothing further to contribute once its write has landed. It is
   * lifted for tools whose contract declares a repeatable capability, because computing
   * another scenario or reading another source is the work itself. Authority is
   * unchanged: the chitchat authority gate below still holds, and side-effectful tools
   * still run the approval path on every call.
   */
  for (const toolName of params.activatedCatalogToolNames) {
    const tool = toolByName.get(toolName);
    // Catalog discovery proves availability, not authority to call it in chitchat. Mirrors
    // `resolveAuthorizedToolNames` exactly (via `isChitchatAuthorizedTool`) so a tool that
    // reaches the surface here is never one execution would then refuse. A code-owned
    // explicit pin remains the deliberate escape hatch above.
    const chitchatAuthorizesThisTool =
      params.conversationMode !== 'chitchat' || !tool || isChitchatAuthorizedTool(tool);
    if (
      chitchatAuthorizesThisTool &&
      shouldAcceptContinuationTool({
        toolName,
        toolByName,
        resourceScopedGoalCapabilityToolNames,
        completedResourceScopedGoalCapabilityToolNames,
        completedGoalEvidenceToolNames,
        completedWorkflowToolNames,
        allowUnownedSideEffectfulTool: true,
        allowCompletedTool: isRepeatableActivatedTool(toolName, tool),
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
    Array.from(toolByName.values()).filter((tool) =>
      selectedNames.has(normalizeToolName(tool.name)),
    ),
    stablePrefixToolNames,
  ).map((tool) => {
    const normalizedName = normalizeToolName(tool.name);
    return withPromptCachePlacement(
      tool,
      stablePrefixToolNames.has(normalizedName) ? 'stable_prefix' : 'dynamic_suffix',
    );
  });
}

function orderTurnToolSurface(
  tools: ReadonlyArray<ToolDefinition>,
  stablePrefixToolNames: ReadonlySet<string>,
): ToolDefinition[] {
  return [...tools].sort((left, right) => {
    const leftName = normalizeToolName(left.name);
    const rightName = normalizeToolName(right.name);
    const leftStable = stablePrefixToolNames.has(leftName);
    const rightStable = stablePrefixToolNames.has(rightName);
    if (leftStable !== rightStable) {
      return leftStable ? -1 : 1;
    }
    const leftOrder = STABLE_TOOL_SURFACE_ORDER.get(leftName);
    const rightOrder = STABLE_TOOL_SURFACE_ORDER.get(rightName);

    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }

    return leftName.localeCompare(rightName);
  });
}
