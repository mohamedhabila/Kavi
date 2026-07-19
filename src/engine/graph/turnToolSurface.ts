import type { AgentGoal } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { ConversationMode } from '../../types/conversation';
import { normalizeToolName } from '../tools/toolNameNormalization';
import {
  normalizeToolWorkflowContract,
  workflowProductionSatisfiesConsumption,
} from '../tools/toolWorkflowContracts';
import {
  DEFAULT_CORE_TOOL_NAMES,
  resolveGoalCapabilityToolNames,
  resolveTurnToolSurface,
} from '../goals/toolSurface';
import {
  DISCOVERY_ACTIVATION_TOOL_NAMES,
  extractDiscoveryActivatedToolNames,
  extractPreviousTurnDynamicToolNames,
  hasUnresolvedDiscoveryToolCallInTurn,
  mergeActivatedCatalogToolNames,
} from './discoveryToolActivation';

function getMessagesSinceLatestUserMessage(
  workingMessages: ReadonlyArray<Message>,
): ReadonlyArray<Message> {
  for (let index = workingMessages.length - 1; index >= 0; index -= 1) {
    if (workingMessages[index]?.role === 'user') {
      return workingMessages.slice(index + 1);
    }
  }

  return workingMessages;
}

function getMessagesFromPreviousUserTurn(
  workingMessages: ReadonlyArray<Message>,
): ReadonlyArray<Message> {
  let latestUserIndex = -1;

  for (let index = workingMessages.length - 1; index >= 0; index -= 1) {
    if (workingMessages[index]?.role !== 'user') {
      continue;
    }
    if (latestUserIndex < 0) {
      latestUserIndex = index;
      continue;
    }
    return workingMessages.slice(index + 1, latestUserIndex);
  }

  return [];
}

function normalizeToolCallNames(toolCalls: ReadonlyArray<{ name?: string }> | undefined): string[] {
  return (toolCalls ?? [])
    .map((toolCall) => (typeof toolCall.name === 'string' ? normalizeToolName(toolCall.name) : ''))
    .filter(Boolean);
}

function extractRecentContinuationToolNames(
  messagesSinceLatestUserMessage: ReadonlyArray<Message>,
): Set<string> {
  const recentToolNames = new Set<string>();

  for (const message of messagesSinceLatestUserMessage) {
    for (const toolName of normalizeToolCallNames(message.toolCalls)) {
      if (
        !toolName ||
        DEFAULT_CORE_TOOL_NAMES.has(toolName) ||
        DISCOVERY_ACTIVATION_TOOL_NAMES.has(toolName)
      ) {
        continue;
      }
      recentToolNames.add(toolName);
    }
  }

  return recentToolNames;
}

function extractCompletedContinuationToolNames(messages: ReadonlyArray<Message>): Set<string> {
  const completedToolNames = new Set<string>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.status !== 'completed') {
        continue;
      }
      const toolName = normalizeToolName(toolCall.name);
      if (
        !toolName ||
        DEFAULT_CORE_TOOL_NAMES.has(toolName) ||
        DISCOVERY_ACTIVATION_TOOL_NAMES.has(toolName)
      ) {
        continue;
      }
      completedToolNames.add(toolName);
    }
  }

  return completedToolNames;
}

function resolveWorkflowContinuationToolNames(
  allTools: ReadonlyArray<ToolDefinition>,
  seedToolNames: Iterable<string>,
): Set<string> {
  const toolByName = new Map<string, ToolDefinition>();
  const contractByName = new Map<string, ReturnType<typeof normalizeToolWorkflowContract>>();
  for (const tool of allTools) {
    const normalizedName = normalizeToolName(tool.name);
    if (normalizedName) {
      toolByName.set(normalizedName, tool);
      contractByName.set(normalizedName, normalizeToolWorkflowContract(tool.contract));
    }
  }
  const continuationToolNames = new Set<string>();
  const observedProductions: Array<{
    producerName: string;
    production: ReturnType<typeof normalizeToolWorkflowContract>['produces'][number];
  }> = [];
  const normalizedSeedToolNames = new Set<string>();

  for (const seedToolName of seedToolNames) {
    const normalizedSeedToolName = normalizeToolName(seedToolName);
    const tool = toolByName.get(normalizedSeedToolName);
    const contract = contractByName.get(normalizedSeedToolName);
    if (!tool || !contract) {
      continue;
    }
    normalizedSeedToolNames.add(normalizedSeedToolName);

    for (const successor of contract.precedes) {
      const normalized = normalizeToolName(successor);
      if (normalized && toolByName.has(normalized)) {
        continuationToolNames.add(normalized);
      }
    }

    for (const production of contract.produces) {
      observedProductions.push({
        producerName: normalizedSeedToolName,
        production,
      });
    }
  }

  if (observedProductions.length === 0) {
    return continuationToolNames;
  }

  for (const [toolName, contract] of contractByName) {
    if (normalizedSeedToolNames.has(toolName)) {
      continue;
    }

    const consumesObservedResource = contract.consumes.some((consumption) =>
      observedProductions.some(
        ({ producerName, production }) =>
          producerName !== toolName &&
          workflowProductionSatisfiesConsumption(production, consumption),
      ),
    );
    if (consumesObservedResource && toolByName.has(toolName)) {
      continuationToolNames.add(toolName);
    }
  }

  return continuationToolNames;
}

export async function resolveDefaultGroundedRequestScopedTools(params: {
  allTools: ReadonlyArray<ToolDefinition>;
  conversationMode?: ConversationMode;
  observedToolNames: Iterable<string>;
  goals?: ReadonlyArray<AgentGoal>;
  pendingAsyncMonitorToolNames?: ReadonlySet<string>;
  workingMessages: ReadonlyArray<Message>;
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  sessionActivatedToolNames?: ReadonlyArray<string>;
}): Promise<ToolDefinition[]> {
  const messagesSinceLatestUserMessage = getMessagesSinceLatestUserMessage(params.workingMessages);
  const previousTurnMessages = getMessagesFromPreviousUserTurn(params.workingMessages);
  const turnActivatedCatalogToolNames = extractDiscoveryActivatedToolNames(
    messagesSinceLatestUserMessage,
  );
  const previousTurnDynamicToolNames = extractPreviousTurnDynamicToolNames(previousTurnMessages);
  const activatedCatalogToolNames = mergeActivatedCatalogToolNames(turnActivatedCatalogToolNames, [
    ...(params.sessionActivatedToolNames ?? []),
    ...previousTurnDynamicToolNames,
  ]);
  const unresolvedDiscoveryToolCallInTurn = hasUnresolvedDiscoveryToolCallInTurn(
    messagesSinceLatestUserMessage,
  );
  const turnToolSurfaceParams = {
    unresolvedDiscoveryToolCallInTurn,
    activatedCatalogToolNames,
  };
  const goals = params.goals ?? [];
  const pendingAsyncMonitorToolNames = params.pendingAsyncMonitorToolNames ?? new Set<string>();
  const recentContinuationToolNames = extractRecentContinuationToolNames(
    messagesSinceLatestUserMessage,
  );
  const previousTurnToolNames = extractCompletedContinuationToolNames(previousTurnMessages);
  const observedToolNames = Array.from(params.observedToolNames)
    .map((toolName) => normalizeToolName(toolName))
    .filter(Boolean);
  const workflowContinuationToolNames = resolveWorkflowContinuationToolNames(params.allTools, [
    ...recentContinuationToolNames,
    ...previousTurnToolNames,
    ...observedToolNames,
  ]);
  const conversationalWorkflowContinuationToolNames = resolveWorkflowContinuationToolNames(
    params.allTools,
    [...recentContinuationToolNames, ...previousTurnToolNames],
  );
  const turnContinuationToolNames = new Set([
    ...recentContinuationToolNames,
    ...workflowContinuationToolNames,
  ]);
  const hasObservedToolNames = observedToolNames.length > 0;
  const explicitToolSurfaceToolNames = params.explicitToolSurfaceToolNames ?? [];
  const hasGoalScopedCallableTools = resolveGoalCapabilityToolNames(goals, params.allTools).some(
    (toolName) => {
      const normalizedName = normalizeToolName(toolName);
      return normalizedName && !DISCOVERY_ACTIVATION_TOOL_NAMES.has(normalizedName);
    },
  );
  const hasSurfaceContinuationSignals =
    pendingAsyncMonitorToolNames.size > 0 ||
    explicitToolSurfaceToolNames.length > 0 ||
    hasGoalScopedCallableTools ||
    turnContinuationToolNames.size > 0 ||
    hasObservedToolNames ||
    activatedCatalogToolNames.size > 0 ||
    unresolvedDiscoveryToolCallInTurn;

  return resolveTurnToolSurface({
    allTools: params.allTools,
    conversationMode: params.conversationMode,
    goals,
    pendingAsyncMonitorToolNames,
    explicitToolSurfaceToolNames,
    observedToolNames,
    recentContinuationToolNames: turnContinuationToolNames,
    workflowContinuationToolNames: conversationalWorkflowContinuationToolNames,
    ...turnToolSurfaceParams,
    includeToolCatalog:
      !hasSurfaceContinuationSignals ||
      (activatedCatalogToolNames.size === 0 &&
        pendingAsyncMonitorToolNames.size === 0 &&
        explicitToolSurfaceToolNames.length === 0 &&
        !hasGoalScopedCallableTools),
  });
}
