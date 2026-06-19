import type { OrchestratorCallbacks } from '../../engine/orchestrator';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  buildSubAgentTaskLedgerSignature,
  describeActiveSubAgentTask,
  selectSubAgentTaskLedger,
} from './subAgentTaskLedger';
import { buildSubAgentResponsePreview } from './lifecycle/runText';
import type {
  ProgressChanges,
  SubAgentOrchestratorCallbackParams,
} from './subAgentOrchestratorCallbackTypes';

export function createSubAgentOrchestratorProgressCallbacks<TAgent extends SubAgentSnapshot>(
  params: SubAgentOrchestratorCallbackParams<TAgent>,
): Pick<
  OrchestratorCallbacks,
  | 'onAgentControlGraphStateChange'
  | 'onStateChange'
  | 'onToolCallQueued'
  | 'onToken'
  | 'onReasoning'
  | 'onAssistantStreamReset'
> {
  return {
    onAgentControlGraphStateChange: (state) => {
      const taskLedger = selectSubAgentTaskLedger(state);
      const taskLedgerSignature = buildSubAgentTaskLedgerSignature(taskLedger);
      if (taskLedgerSignature === params.runtimeState.lastTaskLedgerSignature) {
        return;
      }

      params.runtimeState.lastTaskLedgerSignature = taskLedgerSignature;
      const activeTaskDescription = describeActiveSubAgentTask(taskLedger);
      params.updateAgentProgress(
        params.subAgent,
        {
          taskLedger: taskLedger.length > 0 ? taskLedger : undefined,
          ...(activeTaskDescription && !params.subAgent.activeToolName
            ? {
                currentActivity: activeTaskDescription,
                launchState: 'active',
              }
            : {}),
        } as ProgressChanges<TAgent>,
        {
          announce: false,
          markProgress: false,
        },
      );
    },
    onStateChange: (state) => {
      if (params.abortController.signal.aborted) {
        throw new Error('Sub-agent aborted');
      }

      if (params.subAgent.activeToolName) {
        return;
      }

      const responsePreview = buildSubAgentResponsePreview(
        params.runtimeState.outputText,
        params.maxToolResultPreviewChars,
      );
      if (responsePreview) {
        params.updateAgentProgress(params.subAgent, {
          currentActivity: responsePreview,
          launchState: 'active',
        } as ProgressChanges<TAgent>);
        return;
      }

      const nextActivity =
        state === 'responding'
          ? params.runtimeState.toolsUsed.length > 0
            ? 'Preparing next response'
            : 'Preparing initial response'
          : state === 'thinking'
            ? params.runtimeState.toolsUsed.length > 0
              ? 'Planning next verified step'
              : 'Planning task'
            : undefined;

      if (!nextActivity) {
        return;
      }

      params.updateAgentProgress(params.subAgent, {
        currentActivity: nextActivity,
        launchState: 'active',
        ...(state === 'responding' ? { modelResponsePendingSince: Date.now() } : {}),
      } as ProgressChanges<TAgent>);
    },
    onToolCallQueued: () => {
      params.markModelResponseObserved(params.subAgent);
    },
    onToken: (token) => {
      params.runtimeState.outputText += token;
      params.markModelResponseObserved(params.subAgent);
      const responsePreview = buildSubAgentResponsePreview(
        params.runtimeState.outputText,
        params.maxToolResultPreviewChars,
      );
      const now = Date.now();
      if (responsePreview && responsePreview !== params.subAgent.currentActivity) {
        params.runtimeState.lastTokenHeartbeatAt = now;
        params.updateAgentProgress(params.subAgent, {
          currentActivity: responsePreview,
          launchState: 'active',
        } as ProgressChanges<TAgent>);
        return;
      }

      if (now - params.runtimeState.lastTokenHeartbeatAt >= 1500) {
        params.runtimeState.lastTokenHeartbeatAt = now;
        params.updateAgentProgress(
          params.subAgent,
          {
            launchState: 'active',
          } as ProgressChanges<TAgent>,
          {
            announce: false,
          },
        );
      }
    },
    onReasoning: () => {
      params.markModelResponseObserved(params.subAgent);
      if (
        buildSubAgentResponsePreview(
          params.runtimeState.outputText,
          params.maxToolResultPreviewChars,
        )
      ) {
        const now = Date.now();
        if (now - params.runtimeState.lastTokenHeartbeatAt >= 1500) {
          params.runtimeState.lastTokenHeartbeatAt = now;
          params.updateAgentProgress(
            params.subAgent,
            {
              launchState: 'active',
            } as ProgressChanges<TAgent>,
            {
              announce: false,
            },
          );
        }
        return;
      }
      const now = Date.now();
      if (now - params.runtimeState.lastTokenHeartbeatAt >= 1500) {
        params.runtimeState.lastTokenHeartbeatAt = now;
        params.updateAgentProgress(
          params.subAgent,
          {
            currentActivity:
              params.runtimeState.toolsUsed.length > 0
                ? 'Reasoning about tool results'
                : 'Reasoning about the task',
            launchState: 'active',
          } as ProgressChanges<TAgent>,
          {
            announce: false,
          },
        );
      }
    },
    onAssistantStreamReset: () => {
      params.runtimeState.outputText = '';
      params.updateAgentProgress(
        params.subAgent,
        {
          currentActivity:
            params.runtimeState.toolsUsed.length > 0
              ? 'Preparing next response'
              : 'Preparing initial response',
          launchState: 'active',
        } as ProgressChanges<TAgent>,
        {
          announce: false,
          markProgress: false,
        },
      );
    },
  };
}
