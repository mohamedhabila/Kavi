// ---------------------------------------------------------------------------
// Kavi — Turn Tool Surface
// ---------------------------------------------------------------------------
// Resolves which tools are exposed for a model turn using structural signals
// only: the core workbench, async monitors, explicit pins, discovery
// activation, and workflow continuation.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import {
  normalizeToolWorkflowContract,
  workflowProductionSatisfiesConsumption,
} from './toolWorkflowContracts';
import { normalizeToolName } from './toolNameNormalization';
import { UPDATE_PLAN_TOOL_NAME } from './plan-definitions';
import { isRepeatableActivatedTool, shouldAcceptContinuationTool } from './toolSurfaceRetention';
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
  UPDATE_PLAN_TOOL_NAME,
  'memory_remember',
  'memory_search',
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
  UPDATE_PLAN_TOOL_NAME,
  'memory_remember',
  'memory_search',
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
  'share_text',
  'clipboard_read',
  'clipboard_write',
  'photos_pick',
  'location_current',
  'device_query',
  'notification_send',
] as const;

export const DEFAULT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set<string>(
  DEFAULT_CORE_TOOL_ORDER,
);
const STABLE_TOOL_SURFACE_ORDER = new Map(
  [...STABLE_TOOL_SURFACE_ORDER_VALUES, 'tool_catalog', 'tool_describe'].map((name, index) => [
    name,
    index,
  ]),
);

type PromptCachePlacement = Exclude<
  NonNullable<ToolDefinition['promptCache']>['placement'],
  undefined
>;

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

export interface ResolveTurnToolSurfaceParams {
  allTools: ReadonlyArray<ToolDefinition>;
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

  const completedWorkflowToolNames = new Set(
    Array.from(params.observedToolNames)
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );

  for (const normalized of completedWorkflowToolNames) {
    if (
      normalized &&
      shouldAcceptContinuationTool({
        toolName: normalized,
        toolByName,
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
   * another scenario or reading another source is the work itself. Side-effectful tools
   * still run the approval path on every call.
   */
  for (const toolName of params.activatedCatalogToolNames) {
    const tool = toolByName.get(toolName);
    if (
      shouldAcceptContinuationTool({
        toolName,
        toolByName,
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
