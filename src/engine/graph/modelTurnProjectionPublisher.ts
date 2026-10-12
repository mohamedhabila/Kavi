import type { ToolCall } from '../../types/message';
import type { ExecuteAgentControlGraphModelTurnParams } from './modelTurnExecutionTypes';

// Shared between the streaming (`modelTurnExecutionStreaming.ts`) and send-message
// (`modelTurnExecutionSendMessage.ts`) request paths: both publish model output to the UI in
// small batches, so the batching lives once here instead of being duplicated per path.

const MODEL_PROJECTION_BATCH_MAX_LATENCY_MS = 48;
const MODEL_PROJECTION_BATCH_MAX_EVENTS = 24;
const MODEL_PROJECTION_BATCH_MAX_TEXT_CHARS = 768;

type ModelProjectionOperation =
  | { kind: 'token'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; toolCall: ToolCall };

export function createModelProjectionPublisher(params: {
  callbacks: ExecuteAgentControlGraphModelTurnParams['callbacks'];
}) {
  let batch: ModelProjectionOperation[] = [];
  let batchEventCount = 0;
  let batchTextChars = 0;
  let batchStartedAt: number | undefined;

  const clearBatch = () => {
    batch = [];
    batchEventCount = 0;
    batchTextChars = 0;
    batchStartedAt = undefined;
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
      for (const operation of operations) {
        switch (operation.kind) {
          case 'token':
            params.callbacks.onToken(operation.content);
            break;
          case 'reasoning':
            params.callbacks.onReasoning?.(operation.content);
            break;
          case 'tool_call':
            params.callbacks.onToolCallQueued?.(operation.toolCall);
            break;
        }
      }
    },
    nextDeadline(): number | undefined {
      return batchStartedAt === undefined
        ? undefined
        : batchStartedAt + MODEL_PROJECTION_BATCH_MAX_LATENCY_MS;
    },
    onDeadline() {
      if (
        batchStartedAt !== undefined &&
        batchStartedAt + MODEL_PROJECTION_BATCH_MAX_LATENCY_MS <= Date.now()
      ) {
        this.flush();
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
