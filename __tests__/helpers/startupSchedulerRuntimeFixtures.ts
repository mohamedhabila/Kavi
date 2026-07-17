import type {
  OrchestratorCallbacks,
  OrchestratorRunResult,
} from '../../src/engine/orchestrator/types';
import type {
  ToolMessageOutcome,
  ToolMessageOutcomeStatus,
} from '../../src/engine/toolExecution/toolMessageOutcome';
import type { SchedulerExecutionResult } from '../../src/services/scheduler/executionResult';
import type { checkpointScheduledExecutionResult } from '../../src/services/scheduler/jobExecutorPersistence';
import type { AssistantMessageMetadata } from '../../src/types/message';
import type { LlmProviderConfig } from '../../src/types/provider';

export const completedOrchestratorRun: OrchestratorRunResult = {
  terminalDisposition: 'final_candidate',
};

export const completeFinalMetadata: AssistantMessageMetadata = {
  kind: 'final',
  completionStatus: 'complete',
  finishReason: 'stop',
};

export function toolMessageOutcome(
  toolCallId: string,
  status: ToolMessageOutcomeStatus,
  content: string,
): ToolMessageOutcome {
  return { version: 1, toolCallId, status, content };
}

export function emitWorkerSurfaceFollowupSequence(callbacks: OrchestratorCallbacks): void {
  callbacks.onToolCallStart({
    id: 'tc-surface',
    name: 'sessions_surface_output',
    arguments: '{"sessionId":"worker-1"}',
    status: 'running',
  });
  callbacks.onToolCallComplete({
    id: 'tc-surface',
    name: 'sessions_surface_output',
    arguments: '{"sessionId":"worker-1"}',
    status: 'completed',
    result: JSON.stringify({
      status: 'surfaced',
      sessionId: 'worker-1',
      output: 'Worker-authored final answer',
    }),
  });
  callbacks.onToolMessage(toolMessageOutcome('tc-surface', 'completed', 'tool result'));
  callbacks.onAssistantMessage(
    'Continuing with another action.',
    [{ id: 'tc-follow-up', name: 'web_fetch', arguments: '{}', status: 'running' }],
    undefined,
    {
      kind: 'intermediate',
      completionStatus: 'complete',
      finishReason: 'tool_calls',
    },
  );
  callbacks.onAssistantMessage('Final action completed.', [], undefined, completeFinalMetadata);
  callbacks.onDone();
}

export const startupTestProvider: LlmProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-5.4',
  enabled: true,
};

export async function mockStartupScheduledExecutionCheckpoint(
  params: Parameters<typeof checkpointScheduledExecutionResult>[0],
): Promise<SchedulerExecutionResult> {
  return {
    output: params.output,
    conversationId: params.conversationId,
    ...((params.warnings?.length ?? 0) > 0
      ? { warnings: params.warnings, conversationDurable: false }
      : {}),
  };
}
