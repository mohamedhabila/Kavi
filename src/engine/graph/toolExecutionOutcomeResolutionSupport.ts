import type { RequestClarificationToolResult } from '../../services/agents/requestClarification';
import { resolveRequestDecision } from '../../services/agents/requestDecisionPolicy';
import { REQUEST_FRAME_VERSION, type RequestFrame } from '../../services/agents/requestFrame';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../services/agents/requestUnderstandingProjection';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { ToolCallRecord } from '../loopDetection';
import type { ToolMessageOutcome } from '../toolExecution/toolMessageOutcome';

export function updateToolCallHistoryResult(params: {
  history: ToolCallRecord[] | undefined;
  toolCallId: string;
  toolName: string;
  argumentsText: string | undefined;
  result: string;
  status: ToolMessageOutcome['status'];
}): void {
  if (!params.history) return;

  for (let index = params.history.length - 1; index >= 0; index -= 1) {
    const entry = params.history[index];
    const idMatches = entry?.id && entry.id === params.toolCallId;
    const callMatches =
      !entry?.id &&
      entry?.name === params.toolName &&
      entry.arguments === (params.argumentsText ?? '{}');
    if (!entry || (!idMatches && !callMatches)) continue;

    params.history[index] = {
      ...entry,
      result: params.result,
      status: params.status,
    };
    return;
  }
}

export function buildClarificationRequestUnderstanding(params: {
  graphSnapshot: AgentRunControlGraphState;
  request: RequestClarificationToolResult;
}) {
  const routing = params.graphSnapshot.requestUnderstanding?.routing;
  if (!routing || routing.status !== 'known') return undefined;

  const baseFrame: RequestFrame = {
    version: REQUEST_FRAME_VERSION,
    input: {
      kind: routing.inputKind,
      attachmentCount: routing.attachmentCount,
    },
    continuation: routing.continuation,
    requiredInformation: [],
    decision: {
      action: 'act',
      reason: 'actionable_input',
    },
  };
  const clarificationFrame = resolveRequestDecision({
    frame: baseFrame,
    requiredInformation: params.request.requiredInformation,
  });
  return summarizeRequestUnderstanding(
    projectRequestUnderstanding({ requestFrame: clarificationFrame }),
  );
}
