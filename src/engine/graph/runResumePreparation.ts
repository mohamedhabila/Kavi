import type { AgentRun, AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import { prepareAgentRunControlGraphForResume } from '../../services/agents/agentControlGraphState';
import {
  isWorkflowTaskAnchor,
  resolveWorkflowTaskAnchor,
  type WorkflowTaskAnchor,
} from './workflowTaskAnchor';

function normalizeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export type AgentRunResumePreparation = {
  kind: 'ready';
  initialAgentControlGraphState?: AgentRunControlGraphState;
  workflowScopeUserMessageId: string;
  workflowTaskAnchor: WorkflowTaskAnchor;
} | {
  kind: 'unavailable';
  reason: 'missing_request' | 'missing_existing_owner' | 'missing_user_response';
  requestedSourceMessageId?: string;
};

export function prepareE2EOrchestratorTurnResume(
  params:
    | {
        graphState?: undefined;
        userMessageId: string;
        messages: ReadonlyArray<Message>;
        updatedAt?: number;
      }
    | {
        graphState: AgentRunControlGraphState;
        userMessageId: string;
        workflowTaskAnchor: WorkflowTaskAnchor;
        messages: ReadonlyArray<Message>;
        updatedAt?: number;
      },
): AgentRunResumePreparation {
  if (!params.graphState) {
    return prepareAgentRunResumeForOrchestrator({
      fallbackUserMessageId: params.userMessageId,
      messages: params.messages,
      updatedAt: params.updatedAt,
    });
  }

  return prepareAgentRunResumeForOrchestrator({
    existingRun: {
      controlGraph: params.graphState,
      userMessageId: params.userMessageId,
      workflowTaskAnchor: params.workflowTaskAnchor,
    },
    fallbackUserMessageId: params.userMessageId,
    messages: params.messages,
    updatedAt: params.updatedAt,
  });
}

export function prepareAgentRunResumeForOrchestrator(params: {
  existingRun?: Pick<AgentRun, 'controlGraph' | 'userMessageId' | 'workflowTaskAnchor'>;
  fallbackUserMessageId?: string;
  messages: ReadonlyArray<Message>;
  resolvedUserInformationKeys?: ReadonlyArray<string>;
  updatedAt?: number;
}): AgentRunResumePreparation {
  if (params.existingRun) {
    const requestedSourceMessageId = normalizeId(params.existingRun.userMessageId);
    const storedAnchor = params.existingRun.workflowTaskAnchor;
    if (
      !requestedSourceMessageId ||
      !isWorkflowTaskAnchor(storedAnchor) ||
      storedAnchor.sourceMessageId !== requestedSourceMessageId
    ) {
      return {
        kind: 'unavailable',
        reason: 'missing_existing_owner',
        ...(requestedSourceMessageId ? { requestedSourceMessageId } : {}),
      };
    }

    if (params.existingRun.controlGraph?.status === 'awaiting_user') {
      const requestedAfterUserMessageId =
        params.existingRun.controlGraph.pendingUserInput?.requestedAfterUserMessageId;
      const sourceIndex = requestedAfterUserMessageId
        ? params.messages.findIndex((message) => message.id === requestedAfterUserMessageId)
        : -1;
      const responseIndex = params.messages.findLastIndex(
        (message, index) => message.role === 'user' && index > sourceIndex,
      );
      if (sourceIndex < 0 || responseIndex <= sourceIndex) {
        return {
          kind: 'unavailable',
          reason: 'missing_user_response',
          ...(requestedAfterUserMessageId
            ? { requestedSourceMessageId: requestedAfterUserMessageId }
            : {}),
        };
      }
    }

    const timestamp = params.updatedAt ?? Date.now();
    return {
      kind: 'ready',
      initialAgentControlGraphState: prepareAgentRunControlGraphForResume(
        params.existingRun.controlGraph,
        {
          reason: 'resuming a running agent run',
          resolvedUserInformationKeys: params.resolvedUserInformationKeys,
          updatedAt: timestamp,
        },
      ),
      workflowScopeUserMessageId: requestedSourceMessageId,
      workflowTaskAnchor: storedAnchor,
    };
  }

  const requestedScopeUserMessageId =
    normalizeId(params.fallbackUserMessageId);
  const anchorResolution = resolveWorkflowTaskAnchor({
    messages: params.messages,
    sourceMessageId: requestedScopeUserMessageId,
    existingOwner: false,
  });
  if (anchorResolution.kind === 'unavailable') {
    return anchorResolution;
  }
  const workflowScopeUserMessageId = anchorResolution.anchor.sourceMessageId;

  return {
    kind: 'ready',
    workflowScopeUserMessageId,
    workflowTaskAnchor: anchorResolution.anchor,
  };
}
