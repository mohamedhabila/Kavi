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
import { findLiveRuntimeExternalToolDeclaration } from '../tools/liveRuntimeExternalToolDeclaration';
import type { ToolDefinition } from '../../types/tool';

function completePreflightFailure(params: {
  lifecycle: ToolExecutionLifecycleParams;
  effectiveToolCall: RuntimeToolCallInput;
  idPrefix: string;
  content: string;
  failureKind: 'workflow_guard' | 'tool_filter' | 'unknown_tool' | 'invalid_arguments';
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

/** A built-in's contract, or the live one of a connected integration or loaded skill. */
function findRegisteredToolDefinition(toolName: string): ToolDefinition | undefined {
  return (
    TOOL_DEFINITIONS.find(
      (tool) => tool?.name && resolveRegisteredToolName(tool.name) === toolName,
    ) ?? findLiveRuntimeExternalToolDeclaration(toolName)
  );
}

/** Supplies the registered contract so an unadvertised call is still schema-checked. */
function withRegisteredToolDefinition(
  toolName: string,
  tools: ToolExecutionLifecycleParams['groundedRequestScopedTools'],
): ToolExecutionLifecycleParams['groundedRequestScopedTools'] {
  const registered = findRegisteredToolDefinition(toolName);
  return registered ? [...(tools ?? []), registered] : tools;
}

function findGroundedToolDeclaration(
  toolName: string,
  tools: ToolExecutionLifecycleParams['groundedRequestScopedTools'],
) {
  return tools?.find((tool) => resolveRegisteredToolName(tool.name) === toolName);
}

/** The declaration a call is held to: the one this turn advertised, else the registered one. */
export function findToolDeclaration(
  toolName: string,
  tools: ToolExecutionLifecycleParams['groundedRequestScopedTools'],
): ToolDefinition | undefined {
  return findGroundedToolDeclaration(toolName, tools) ?? findRegisteredToolDefinition(toolName);
}

export function resolveToolCallPreflight(
  params: ToolExecutionLifecycleParams,
  effectiveToolCall: RuntimeToolCallInput,
): ToolExecutionLifecycleResult | undefined {
  const canonicalToolCall = {
    ...effectiveToolCall,
    name: resolveRegisteredToolName(effectiveToolCall.name),
  };

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
  const groundedDeclaration = findToolDeclaration(
    canonicalToolCall.name,
    params.groundedRequestScopedTools,
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
      failureKind: 'invalid_arguments',
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
