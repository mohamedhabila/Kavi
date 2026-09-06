import type { ToolCall } from '../../types/message';
import type { ExecuteAgentControlGraphModelTurnParams } from './modelTurnExecutionTypes';
import {
  assertModelTurnMemoryPolicyBindingDurablyCurrent,
  type ModelTurnMemoryPolicyBinding,
} from '../authority/modelTurnMemoryPolicyBinding';

// Shared between the streaming (`modelTurnExecutionStreaming.ts`) and send-message
// (`modelTurnExecutionSendMessage.ts`) request paths: both need to publish model output to the
// UI in small batches while staying subordinate to the same memory-authority fence, so the
// batching/authority-lease logic lives once here instead of being duplicated per path.

const MODEL_PROJECTION_BATCH_MAX_LATENCY_MS = 48;
const MODEL_PROJECTION_BATCH_MAX_EVENTS = 24;
const MODEL_PROJECTION_BATCH_MAX_TEXT_CHARS = 768;
const MODEL_PROJECTION_AUTHORITY_LEASE_MS = 200;

type ModelProjectionOperation =
  | { kind: 'token'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; toolCall: ToolCall };

export function createModelProjectionPublisher(params: {
  callbacks: ExecuteAgentControlGraphModelTurnParams['callbacks'];
  memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  onInvalidated: () => void;
}) {
  let batch: ModelProjectionOperation[] = [];
  let batchEventCount = 0;
  let batchTextChars = 0;
  let batchStartedAt: number | undefined;
  let authorityLeaseDeadline: number | undefined;
  let hasPublishedProjection = false;
  let invalidated = false;

  const clearBatch = () => {
    batch = [];
    batchEventCount = 0;
    batchTextChars = 0;
    batchStartedAt = undefined;
  };
  const invalidate = () => {
    if (invalidated) return;
    invalidated = true;
    clearBatch();
    authorityLeaseDeadline = undefined;
    params.onInvalidated();
    if (hasPublishedProjection) {
      try {
        params.callbacks.onAssistantStreamReset?.();
      } catch {
        // Reset observer failures are ancillary; authority revocation remains primary.
      }
    }
  };
  const assertDurablyCurrent = () => {
    try {
      assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
    } catch (error) {
      invalidate();
      throw error;
    }
  };
  const renewAuthorityLease = () => {
    if (params.memoryPolicyBinding.kind === 'policy_independent') {
      authorityLeaseDeadline = undefined;
      return;
    }
    const now = Date.now();
    const bindingDeadline = params.memoryPolicyBinding.validUntil ?? Number.POSITIVE_INFINITY;
    authorityLeaseDeadline = Math.min(now + MODEL_PROJECTION_AUTHORITY_LEASE_MS, bindingDeadline);
  };
  const enqueueText = (kind: 'token' | 'reasoning', content: string) => {
    if (!content) return;
    batchStartedAt ??= Date.now();
    batchEventCount += 1;
    batchTextChars += content.length;
    const previous = batch.at(-1);
    if (previous?.kind === kind) {
      previous.content += content;
      return;
    }
    batch.push({ kind, content });
  };

  return {
    enqueueReasoning(content: string) {
      enqueueText('reasoning', content);
    },
    enqueueToken(content: string) {
      enqueueText('token', content);
    },
    enqueueToolCall(toolCall: ToolCall) {
      batchStartedAt ??= Date.now();
      batchEventCount += 1;
      batch.push({ kind: 'tool_call', toolCall });
    },
    flush() {
      if (batch.length === 0) return;
      const operations = batch;
      clearBatch();
      const publishGroup = (group: ReadonlyArray<ModelProjectionOperation>) => {
        assertDurablyCurrent();
        let callbackThrew = false;
        let callbackError: unknown;
        try {
          for (const operation of group) {
            switch (operation.kind) {
              case 'token':
                hasPublishedProjection = true;
                params.callbacks.onToken(operation.content);
                break;
              case 'reasoning':
                if (params.callbacks.onReasoning) {
                  hasPublishedProjection = true;
                  params.callbacks.onReasoning(operation.content);
                }
                break;
              case 'tool_call':
                if (params.callbacks.onToolCallQueued) {
                  hasPublishedProjection = true;
                  params.callbacks.onToolCallQueued(operation.toolCall);
                }
                break;
            }
          }
        } catch (error) {
          callbackThrew = true;
          callbackError = error;
        }
        assertDurablyCurrent();
        if (callbackThrew) throw callbackError;
      };
      let textGroup: ModelProjectionOperation[] = [];
      for (const operation of operations) {
        if (operation.kind !== 'tool_call') {
          textGroup.push(operation);
          continue;
        }
        if (textGroup.length > 0) {
          publishGroup(textGroup);
          textGroup = [];
        }
        publishGroup([operation]);
      }
      if (textGroup.length > 0) publishGroup(textGroup);
      renewAuthorityLease();
    },
    invalidate,
    nextDeadline(): number | undefined {
      const batchDeadline =
        batchStartedAt === undefined
          ? undefined
          : batchStartedAt + MODEL_PROJECTION_BATCH_MAX_LATENCY_MS;
      if (batchDeadline === undefined) return authorityLeaseDeadline;
      if (authorityLeaseDeadline === undefined) return batchDeadline;
      return Math.min(batchDeadline, authorityLeaseDeadline);
    },
    onDeadline() {
      const now = Date.now();
      if (
        batchStartedAt !== undefined &&
        batchStartedAt + MODEL_PROJECTION_BATCH_MAX_LATENCY_MS <= now
      ) {
        this.flush();
      }
      if (authorityLeaseDeadline !== undefined && authorityLeaseDeadline <= Date.now()) {
        assertDurablyCurrent();
        renewAuthorityLease();
      }
    },
    shouldFlushImmediately(): boolean {
      return (
        batchEventCount >= MODEL_PROJECTION_BATCH_MAX_EVENTS ||
        batchTextChars >= MODEL_PROJECTION_BATCH_MAX_TEXT_CHARS
      );
    },
  };
}
