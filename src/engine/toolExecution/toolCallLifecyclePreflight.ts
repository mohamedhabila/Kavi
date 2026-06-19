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
import { recordLifecycleToolCall } from './toolCallLifecycleRecording';
import { validateToolArgumentsAgainstSchema } from './toolArgumentSchemaValidation';
import type {
  ToolExecutionLifecycleParams,
  ToolExecutionLifecycleResult,
} from './toolCallLifecycleTypes';

function completePreflightFailure(params: {
  lifecycle: ToolExecutionLifecycleParams;
  effectiveToolCall: RuntimeToolCallInput;
  idPrefix: string;
  content: string;
  failureKind: 'workflow_guard' | 'tool_filter' | 'unknown_tool' | 'tool_error';
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
    params.preflightBlockedKind,
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
      content: `Tool "${canonicalToolCall.name}" is not registered.`,
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
      content: `Tool "${canonicalToolCall.name}" is not allowed in this context.`,
      failureKind: 'tool_filter',
      preflightBlockedKind: 'tool_filter',
      notifyBlocked: true,
    });
  }

  const schemaValidationError = validateToolArgumentsAgainstSchema({
    toolName: canonicalToolCall.name,
    argumentsText: canonicalToolCall.arguments,
    tools: params.groundedRequestScopedTools,
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
  });
}
