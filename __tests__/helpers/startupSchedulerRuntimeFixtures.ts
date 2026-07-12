import type { OrchestratorRunResult } from '../../src/engine/orchestrator/types';
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
};

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
