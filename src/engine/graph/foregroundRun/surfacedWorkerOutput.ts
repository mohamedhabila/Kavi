import {
  buildSurfacedSubAgentOutputToolResultSummary,
  parseSurfacedSubAgentOutputResult,
  type SurfacedSubAgentOutputPayload,
} from '../../../services/agents/surfacedSubAgentOutput';
import type { Message, ToolCall } from '../../../types/message';
import { buildAssistantMessageMetadata } from '../../../utils/assistantMessageMetadata';

export type PendingSurfacedWorkerOutput = SurfacedSubAgentOutputPayload;

export type SurfacedWorkerOutputLock = {
  toolCallId: string;
  messageId: string;
  content: string;
};

export function syncForegroundSurfacedWorkerOutputCompletion(params: {
  pendingOutputs: Map<string, PendingSurfacedWorkerOutput>;
  toolCall: ToolCall;
}): PendingSurfacedWorkerOutput | undefined {
  if (params.toolCall.name !== 'sessions_surface_output') {
    return undefined;
  }

  if (params.toolCall.status !== 'completed') {
    params.pendingOutputs.delete(params.toolCall.id);
    return undefined;
  }

  const surfacedOutput = parseSurfacedSubAgentOutputResult(params.toolCall.result);
  if (!surfacedOutput) {
    params.pendingOutputs.delete(params.toolCall.id);
    return undefined;
  }

  params.pendingOutputs.set(params.toolCall.id, surfacedOutput);
  return surfacedOutput;
}

export function buildForegroundSurfacedWorkerToolMessageEffect(params: {
  pendingOutputs: Map<string, PendingSurfacedWorkerOutput>;
  toolCallId: string;
  rawResult: string;
}): {
  content: string;
  surfacedOutput?: PendingSurfacedWorkerOutput;
} {
  const surfacedOutput = params.pendingOutputs.get(params.toolCallId);
  return {
    content: surfacedOutput
      ? buildSurfacedSubAgentOutputToolResultSummary(surfacedOutput)
      : params.rawResult,
    surfacedOutput,
  };
}

export function buildForegroundSurfacedWorkerFlushEffect(params: {
  pendingOutputs: Map<string, PendingSurfacedWorkerOutput>;
  surfacedMessageId: string;
  toolCallId: string;
}):
  | {
      assistantMessage: Pick<Message, 'assistantMetadata' | 'content' | 'id' | 'role'>;
      latestSummary: string;
      lock: SurfacedWorkerOutputLock;
    }
  | undefined {
  const surfacedOutput = params.pendingOutputs.get(params.toolCallId);
  if (!surfacedOutput) {
    return undefined;
  }

  params.pendingOutputs.delete(params.toolCallId);
  return {
    assistantMessage: {
      id: params.surfacedMessageId,
      role: 'assistant',
      content: surfacedOutput.output,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'surfaced_worker_output_pending',
      }),
    },
    latestSummary: surfacedOutput.output,
    lock: {
      toolCallId: params.toolCallId,
      messageId: params.surfacedMessageId,
      content: surfacedOutput.output,
    },
  };
}
