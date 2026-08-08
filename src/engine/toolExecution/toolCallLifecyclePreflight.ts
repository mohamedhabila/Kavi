import type { PreflightBlockedKind } from '../loopDetection';
import {
  isRegisteredToolName,
  normalizeToolName,
  resolveRegisteredToolName,
} from '../tools/toolNameNormalization';
import {
  buildToolResultMessage,
  createFailedToolCall,
  type RuntimeToolCallInput,
} from './toolExecutionMessages';
import { buildUnauthorizedToolResult } from './unauthorizedToolResult';
import { buildUnknownToolResult } from './unknownToolSuggestion';
import { TOOL_DEFINITIONS } from '../tools/definitions';
import { recordLifecycleToolCall } from './toolCallLifecycleRecording';
import { validateToolArgumentsAgainstSchema } from './toolArgumentSchemaValidation';
import type {
  ToolExecutionLifecycleParams,
  ToolExecutionLifecycleResult,
} from './toolCallLifecycleTypes';
import {
  buildMemoryDisabledToolResult,
  isToolAllowedForMemoryPolicy,
} from '../tools/memoryPolicyToolAuthority';
import {
  buildModelTurnMemoryPolicyExpiredToolResult,
  isModelTurnMemoryPolicyBindingCurrent,
} from '../authority/modelTurnMemoryPolicyBinding';

function completePreflightFailure(params: {
  lifecycle: ToolExecutionLifecycleParams;
  effectiveToolCall: RuntimeToolCallInput;
  idPrefix: string;
  content: string;
  failureKind:
    | 'authority_revoked'
    | 'workflow_guard'
    | 'tool_filter'
    | 'unknown_tool'
    | 'tool_error';
  preflightBlockedKind?: PreflightBlockedKind;
  notifyBlocked?: boolean;
  notifyStart?: boolean;
  notifyComplete?: boolean;
}): ToolExecutionLifecycleResult {
  const failedCall = createFailedToolCall(
    params.effectiveToolCall,
    params.content,
    Date.now(),
    params.failureKind,
  );
  if (params.notifyBlocked) {
    params.lifecycle.onBlockedBeforeExecution?.(params.content, params.effectiveToolCall.name);
  }
  if (params.notifyStart) {
    params.lifecycle.callbacks.onToolCallStart(failedCall);
  }
  if (params.notifyComplete) {
    params.lifecycle.callbacks.onToolCallComplete(failedCall);
  }
  recordLifecycleToolCall(
    params.lifecycle.toolCallHistory,
    params.lifecycle.tc.id,
    params.effectiveToolCall.name,
    params.effectiveToolCall.arguments,
    params.content,
    'failed',
    params.preflightBlockedKind,
    params.lifecycle.iteration,
  );
  return {
    toolCallId: params.lifecycle.tc.id,
    effectiveToolName: params.effectiveToolCall.name,
    toolMessage: buildToolResultMessage({
      idPrefix: params.idPrefix,
      toolCallId: params.lifecycle.tc.id,
      content: params.content,
      toolCall: failedCall,
      isError: true,
    }),
  };
}

function isUnknownToolForPreflight(
  toolName: string,
  availableToolNames: ReadonlySet<string>,
): boolean {
  const normalized = normalizeToolName(toolName);
  if (availableToolNames.has(normalized)) {
    return false;
  }
  return !isRegisteredToolName(toolName);
}

function isOnGroundedToolSurface(
  toolName: string,
  tools: ToolExecutionLifecycleParams['groundedRequestScopedTools'],
): boolean {
  if (tools === undefined) {
    return true;
  }
  return tools.some((tool) => resolveRegisteredToolName(tool.name) === toolName);
}

/**
 * Whether the run may execute this tool at all.
 *
 * An absent set means the caller does not model authority separately — every registered
 * tool that reached here is permitted, which is what the run allowlist and memory policy
 * above have already established.
 */
function isAuthorizedForRun(
  toolName: string,
  authorizedToolNames: ToolExecutionLifecycleParams['authorizedToolNames'],
): boolean {
  if (!authorizedToolNames || authorizedToolNames.size === 0) {
    return true;
  }
  return authorizedToolNames.has(toolName);
}

/** Supplies the registered contract so an unadvertised call is still schema-checked. */
function withRegisteredToolDefinition(
  toolName: string,
  tools: ToolExecutionLifecycleParams['groundedRequestScopedTools'],
): ToolExecutionLifecycleParams['groundedRequestScopedTools'] {
  const registered = TOOL_DEFINITIONS.find(
    (tool) => tool?.name && resolveRegisteredToolName(tool.name) === toolName,
  );
  return registered ? [...(tools ?? []), registered] : tools;
}

function findGroundedToolDeclaration(
  toolName: string,
  tools: ToolExecutionLifecycleParams['groundedRequestScopedTools'],
) {
  return tools?.find((tool) => resolveRegisteredToolName(tool.name) === toolName);
}

export function resolveToolCallPreflight(
  params: ToolExecutionLifecycleParams,
  effectiveToolCall: RuntimeToolCallInput,
): ToolExecutionLifecycleResult | undefined {
  const canonicalToolCall = {
    ...effectiveToolCall,
    name: resolveRegisteredToolName(effectiveToolCall.name),
  };

  if (!isModelTurnMemoryPolicyBindingCurrent(params.modelTurnMemoryPolicyBinding)) {
    return completePreflightFailure({
      lifecycle: params,
      effectiveToolCall: canonicalToolCall,
      idPrefix: params.idPrefixes.filtered,
      content: buildModelTurnMemoryPolicyExpiredToolResult(),
      failureKind: 'authority_revoked',
      preflightBlockedKind: 'authority_revoked',
      notifyBlocked: true,
      notifyStart: true,
      notifyComplete: true,
    });
  }

  if (isUnknownToolForPreflight(canonicalToolCall.name, params.availableToolNames)) {
    return completePreflightFailure({
      lifecycle: params,
      effectiveToolCall: canonicalToolCall,
      idPrefix: params.idPrefixes.blocked,
      content: buildUnknownToolResult({
        toolName: canonicalToolCall.name,
        availableToolNames: params.availableToolNames,
      }),
      failureKind: 'unknown_tool',
      preflightBlockedKind: 'unknown_tool',
      notifyBlocked: true,
    });
  }

  if (params.toolFilter && !params.toolFilter(canonicalToolCall.name)) {
    return completePreflightFailure({
      lifecycle: params,
      effectiveToolCall: canonicalToolCall,
      idPrefix: params.idPrefixes.filtered,
      content: buildUnauthorizedToolResult(canonicalToolCall.name),
      failureKind: 'tool_filter',
      preflightBlockedKind: 'tool_filter',
      notifyBlocked: true,
    });
  }

  // Falls back to the registered contract: memory policy must bind identically whether or
  // not this turn advertised the tool, now that an unadvertised call is allowed to run.
  const groundedDeclaration =
    findGroundedToolDeclaration(canonicalToolCall.name, params.groundedRequestScopedTools) ??
    findGroundedToolDeclaration(
      canonicalToolCall.name,
      withRegisteredToolDefinition(canonicalToolCall.name, undefined),
    );
  if (groundedDeclaration && !isToolAllowedForMemoryPolicy(groundedDeclaration)) {
    return completePreflightFailure({
      lifecycle: params,
      effectiveToolCall: canonicalToolCall,
      idPrefix: params.idPrefixes.filtered,
      content: buildMemoryDisabledToolResult(),
      failureKind: 'tool_filter',
      preflightBlockedKind: 'tool_filter',
      notifyBlocked: true,
      notifyStart: true,
      notifyComplete: true,
    });
  }

  /**
   * Authority decides whether a call runs. Advertisement decides only what the model saw.
   *
   * These used to be the same list, so a registered, permitted tool that this turn had
   * not happened to advertise was refused outright — and the refusal named `tool_catalog`
   * as the way back. That treats the previous turn's guess about what would be needed as
   * though it were knowledge. It is not: which capability a task needs becomes clear while
   * doing the task. Traced on-device, a study needing Monte Carlo called `python`, was
   * told to discover it first, and the discovery call never returned — so a capability the
   * run held throughout became permanently unreachable and the run failed.
   *
   * Now an unadvertised call simply runs. Nothing is loosened: the run allowlist above
   * still refuses, memory policy still refuses, chitchat still refuses through
   * `authorizedToolNames` — a real restriction, since that mode exists so a casual
   * conversation cannot mutate state — and side-effectful tools still take the approval
   * path. What is gone is a refusal that protected nothing and cost a round-trip, or the
   * whole run, every time the work turned out to need something unforeseen.
   */
  if (!isAuthorizedForRun(canonicalToolCall.name, params.authorizedToolNames)) {
    return completePreflightFailure({
      lifecycle: params,
      effectiveToolCall: canonicalToolCall,
      idPrefix: params.idPrefixes.filtered,
      content: buildUnauthorizedToolResult(canonicalToolCall.name),
      failureKind: 'tool_filter',
      preflightBlockedKind: 'tool_filter',
      notifyBlocked: true,
    });
  }

  const schemaValidationError = validateToolArgumentsAgainstSchema({
    toolName: canonicalToolCall.name,
    argumentsText: canonicalToolCall.arguments,
    // An authorized call must be contract-checked whether or not this turn advertised it,
    // or admitting it off-surface would also mean admitting it unvalidated.
    tools: isOnGroundedToolSurface(canonicalToolCall.name, params.groundedRequestScopedTools)
      ? params.groundedRequestScopedTools
      : withRegisteredToolDefinition(canonicalToolCall.name, params.groundedRequestScopedTools),
  });
  if (schemaValidationError) {
    return completePreflightFailure({
      lifecycle: params,
      effectiveToolCall: canonicalToolCall,
      idPrefix: params.idPrefixes.error,
      content: schemaValidationError,
      failureKind: 'tool_error',
      preflightBlockedKind: 'schema_validation',
      notifyStart: true,
      notifyComplete: true,
    });
  }

  const workflowBlocker = params.workflowToolCallBlocker?.(
    canonicalToolCall.name,
    canonicalToolCall.arguments,
  );
  if (!workflowBlocker) {
    return undefined;
  }

  return completePreflightFailure({
    lifecycle: params,
    effectiveToolCall: canonicalToolCall,
    idPrefix: params.idPrefixes.workflow,
    content: workflowBlocker,
    failureKind: 'workflow_guard',
    notifyStart: true,
    notifyComplete: true,
  });
}
