import {
  AgentPersona,
  resolvePersonaModel,
  resolvePersonaSystemPrompt,
  SUPER_AGENT_PERSONA_ID,
} from '../../services/agents/personas';
import { getPersona } from '../../services/agents/registry';
import { getCommand } from '../../services/commands/builtins';
import { isSlashCommand, parseCommand } from '../../services/commands/parser';
import { excludeTrailingInternalUserMessages } from '../../services/context/messageScoping';
import { LlmService } from '../../services/llm/LlmService';
import {
  bindProviderToModel,
  resolveProviderModelSelection,
} from '../../services/llm/support/providerSupport';
import { mcpManager } from '../../services/mcp/manager';
import {
  filterToolsByInvocationPolicy,
  getSkillToolDefinitions,
} from '../../services/skills/manager';
import type { AgentRunAsyncOperation } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { buildFailoverChain, createFailoverState, type FailoverState } from '../failover';
import type { IterationProgressSignature, ToolCallRecord } from '../loopDetection';
import { hydrateProviderApiKey } from '../orchestratorProviderRuntime';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import {
  buildPendingAsyncOperationSignature,
  clonePendingTrackedAsyncOperations,
} from '../pendingAsyncOperations';
import { buildToolDefinitions } from '../tools/definitions';
import {
  filterToolsByRuntimeAvailability,
  getRuntimeToolAvailabilityContext,
  type RuntimeToolAvailabilityContext,
} from '../tools/runtimeAvailability';
import { MAX_TOOL_ITERATIONS, MAX_TOOL_ITERATIONS_SUPERAGENT } from './constants';
import type { OrchestratorCallbacks } from './types';

type BootstrapCallbacks = Pick<
  OrchestratorCallbacks,
  | 'onAssistantMessage'
  | 'onCommandResult'
  | 'onDone'
  | 'onPendingAsyncOperationsChange'
  | 'onStateChange'
>;

export async function tryHandleOrchestratorSlashCommand(params: {
  callbacks: BootstrapCallbacks;
  conversationId: string;
  internalUserMessageCount: number;
  messages: Message[];
}): Promise<boolean> {
  const slashCommandMessages = excludeTrailingInternalUserMessages(
    params.messages,
    params.internalUserMessageCount,
  );
  let lastUserMessageIndex = -1;
  for (let index = slashCommandMessages.length - 1; index >= 0; index -= 1) {
    if (slashCommandMessages[index].role === 'user') {
      lastUserMessageIndex = index;
      break;
    }
  }

  const lastUserMessage =
    lastUserMessageIndex >= 0 ? slashCommandMessages[lastUserMessageIndex] : undefined;
  if (!lastUserMessage || !isSlashCommand(lastUserMessage.content)) {
    return false;
  }

  const parsed = parseCommand(lastUserMessage.content);
  if (!parsed) {
    return false;
  }
  const command = getCommand(parsed.name);
  if (!command) {
    return false;
  }

  const result = await command.handler({
    conversationId: params.conversationId,
    args: parsed.args,
  });
  params.callbacks.onCommandResult?.({
    response: result.response,
    action: result.action,
  });
  if (result.response) {
    params.callbacks.onAssistantMessage(
      result.response,
      [],
      undefined,
      buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'command_result',
      }),
    );
  }
  params.callbacks.onStateChange('idle');
  params.callbacks.onDone();
  return true;
}

function buildTrackedAsyncOperations(
  initialPendingAsyncOperations: AgentRunAsyncOperation[] | undefined,
): Map<string, TrackedAsyncOperation> {
  const trackedAsyncOperations = new Map<string, TrackedAsyncOperation>();
  for (const operation of initialPendingAsyncOperations ?? []) {
    const normalizedResourceId = operation.resourceId?.trim();
    const normalizedKey = operation.key?.trim();
    if (!normalizedResourceId || !normalizedKey) {
      continue;
    }

    trackedAsyncOperations.set(normalizedKey, {
      ...operation,
      key: normalizedKey,
      resourceId: normalizedResourceId,
      displayName: operation.displayName?.trim() || normalizedResourceId,
      lastUpdatedByTool: operation.lastUpdatedByTool?.trim() || 'recovered_async_state',
      updatedAt: Number.isFinite(operation.updatedAt) ? operation.updatedAt : Date.now(),
      monitorToolNames: Array.from(
        new Set(
          (operation.monitorToolNames ?? []).map((toolName) => toolName.trim()).filter(Boolean),
        ),
      ),
      ...(operation.statusArgs ? { statusArgs: { ...operation.statusArgs } } : {}),
      ...(operation.waitToolName?.trim() ? { waitToolName: operation.waitToolName.trim() } : {}),
      ...(operation.waitArgs ? { waitArgs: { ...operation.waitArgs } } : {}),
    });
  }

  return trackedAsyncOperations;
}

export async function prepareOrchestratorSessionBootstrap(params: {
  allProviders?: LlmProviderConfig[];
  callbacks: BootstrapCallbacks;
  conversationId: string;
  enableFailover: boolean;
  internalUserMessageCount: number;
  logger: {
    debug: (message: string) => void;
    devWarn: (message: string) => void;
  };
  messages: Message[];
  model: string;
  personaId?: string;
  provider: LlmProviderConfig;
  systemPrompt: string;
  toolFilter?: (toolName: string) => boolean;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
}): Promise<{
  activeModel: string;
  activeProvider: LlmProviderConfig;
  allTools: ToolDefinition[];
  consecutivePendingAsyncNoToolTurns: number;
  emitPendingAsyncOperationsChange: () => void;
  failoverState: FailoverState | null;
  isSuperAgent: boolean;
  lastPendingAsyncSignature: string;
  llm: LlmService;
  maxToolIterations: number;
  persona: AgentPersona | undefined;
  resolvedPrompt: string;
  runtimeToolAvailability: RuntimeToolAvailabilityContext;
  toolCallHistory: ToolCallRecord[];
  stagnationSignatures: IterationProgressSignature[];
  trackedAsyncOperations: Map<string, TrackedAsyncOperation>;
  warningInjectedThisRound: boolean;
}> {
  const persona: AgentPersona | undefined = params.personaId
    ? getPersona(params.personaId)
    : undefined;
  if (params.personaId && !persona) {
    params.logger.devWarn(
      `Persona '${params.personaId}' not found in registry, falling back to default`,
    );
  }
  const personaRegistryId = persona?.id;
  const isSuperAgent =
    typeof personaRegistryId === 'string' && personaRegistryId === SUPER_AGENT_PERSONA_ID;
  const maxToolIterations = isSuperAgent ? MAX_TOOL_ITERATIONS_SUPERAGENT : MAX_TOOL_ITERATIONS;
  params.logger.debug(
    `conversationId=${params.conversationId}, persona=${persona?.name || 'none'} (superAgent=${isSuperAgent}), maxIterations=${maxToolIterations}`,
  );
  const resolvedPrompt = resolvePersonaSystemPrompt(persona, params.systemPrompt);
  const { providerId: resolvedProviderId, model: resolvedModel } = resolvePersonaModel(
    persona,
    params.provider.id,
    params.model,
  );

  let activeProvider = params.provider;
  let activeModel = resolveProviderModelSelection(activeProvider, resolvedModel, params.model);
  if (resolvedProviderId !== params.provider.id) {
    const found = params.allProviders?.find(
      (candidate) => candidate.id === resolvedProviderId && candidate.enabled,
    );
    if (found) {
      activeProvider = found;
      activeModel = resolveProviderModelSelection(
        activeProvider,
        resolvedModel,
        activeProvider.model,
      );
    } else {
      params.logger.devWarn(
        `Persona requested unavailable provider "${resolvedProviderId}". Continuing with provider "${params.provider.id}".`,
      );
      activeModel = resolveProviderModelSelection(
        activeProvider,
        params.model,
        activeProvider.model,
      );
    }
  }
  const normalizedResolvedModel = typeof resolvedModel === 'string' ? resolvedModel.trim() : '';
  if (normalizedResolvedModel && activeModel !== normalizedResolvedModel) {
    params.logger.devWarn(
      `Persona requested unsupported model "${normalizedResolvedModel}" for provider "${activeProvider.id}". Falling back to "${activeModel}".`,
    );
  }
  activeProvider = bindProviderToModel(await hydrateProviderApiKey(activeProvider), activeModel);

  const mcpTools = mcpManager.getAllToolDefinitions();
  const skillTools = getSkillToolDefinitions();
  const runtimeToolAvailability = getRuntimeToolAvailabilityContext();
  const allToolsUnfiltered = filterToolsByRuntimeAvailability(
    filterToolsByInvocationPolicy(buildToolDefinitions(mcpTools, skillTools)),
    runtimeToolAvailability,
  );
  const allTools = params.toolFilter
    ? allToolsUnfiltered.filter((tool) => params.toolFilter?.(tool.name) !== false)
    : allToolsUnfiltered;

  const llm = new LlmService(activeProvider);
  const toolCallHistory: ToolCallRecord[] = [];
  const stagnationSignatures: IterationProgressSignature[] = [];
  const trackedAsyncOperations = buildTrackedAsyncOperations(params.initialPendingAsyncOperations);
  const emitPendingAsyncOperationsChange = () => {
    params.callbacks.onPendingAsyncOperationsChange?.(
      clonePendingTrackedAsyncOperations(trackedAsyncOperations),
    );
  };
  if (trackedAsyncOperations.size > 0) {
    emitPendingAsyncOperationsChange();
  }
  const lastPendingAsyncSignature = buildPendingAsyncOperationSignature(trackedAsyncOperations);
  let failoverState: FailoverState | null = null;
  if (params.enableFailover && params.allProviders && params.allProviders.length > 0) {
    const chain = buildFailoverChain(params.allProviders, {
      providerId: activeProvider.id,
      model: activeModel,
    });
    if (chain.length > 1) {
      failoverState = createFailoverState(chain, {
        providerId: activeProvider.id,
        model: activeModel,
      });
    }
  }

  return {
    activeModel,
    activeProvider,
    allTools,
    consecutivePendingAsyncNoToolTurns: 0,
    emitPendingAsyncOperationsChange,
    failoverState,
    isSuperAgent,
    lastPendingAsyncSignature,
    llm,
    maxToolIterations,
    persona,
    resolvedPrompt,
    runtimeToolAvailability,
    toolCallHistory,
    stagnationSignatures,
    trackedAsyncOperations,
    warningInjectedThisRound: false,
  };
}
