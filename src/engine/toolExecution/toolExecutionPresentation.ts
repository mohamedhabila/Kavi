import {
  inferToolCapabilityDescriptor,
  type ToolCapabilityDescriptor,
} from '../tools/capabilityRegistry';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { AgentRun } from '../../types/agentRun';
import type { ConversationLogEntry } from '../../types/conversation';

export interface ToolExecutionWorkPhasePresentation {
  title: string;
  checkpointTitle: string;
}

export interface ToolExecutionStartEffect {
  checkpoint: {
    kind: AgentRun['checkpoints'][number]['kind'];
    title: string;
    detail?: string;
    timestamp?: number;
  };
  workPhase: ToolExecutionWorkPhasePresentation;
  logEntry: {
    kind: ConversationLogEntry['kind'];
    title: string;
    detail?: string;
    timestamp?: number;
  };
}

export interface ToolExecutionCompletionEffect {
  checkpoint: {
    kind: AgentRun['checkpoints'][number]['kind'];
    title: string;
    detail?: string;
    timestamp?: number;
  };
  workPhaseDetail: string;
  logEntry: {
    kind: ConversationLogEntry['kind'];
    level: ConversationLogEntry['level'];
    title: string;
    detail?: string;
    timestamp?: number;
  };
  startedDelegatedSession: boolean;
}

function readToolDescriptor(toolName: string | undefined): ToolCapabilityDescriptor | undefined {
  const normalizedToolName = normalizeToolName(toolName || '');
  if (!normalizedToolName) {
    return undefined;
  }

  return inferToolCapabilityDescriptor({
    name: normalizedToolName,
    description: normalizedToolName,
  });
}

function descriptorHasCapability(
  descriptor: ToolCapabilityDescriptor | undefined,
  capability: ToolCapabilityDescriptor['capabilities'][number],
): boolean {
  return descriptor?.capabilities.includes(capability) ?? false;
}

function descriptorHasWorkflowStage(
  descriptor: ToolCapabilityDescriptor | undefined,
  workflowStage: ToolCapabilityDescriptor['workflowStages'][number],
): boolean {
  return descriptor?.workflowStages.includes(workflowStage) ?? false;
}

export function buildToolExecutionWorkPhasePresentation(
  toolName: string | undefined,
): ToolExecutionWorkPhasePresentation {
  const descriptor = readToolDescriptor(toolName);
  const normalizedToolName = normalizeToolName(toolName || '');
  const displayToolName = normalizedToolName || toolName || 'tool';

  if (descriptor?.category === 'sessions') {
    if (descriptorHasWorkflowStage(descriptor, 'start_external_execution')) {
      return {
        title: 'Launching delegated work',
        checkpointTitle: 'Delegated work launch started',
      };
    }

    if (normalizedToolName === 'sessions_cancel') {
      return {
        title: 'Stopping delegated work',
        checkpointTitle: 'Delegated work cancellation started',
      };
    }

    if (descriptorHasWorkflowStage(descriptor, 'continue_external_execution')) {
      return {
        title: 'Continuing delegated work',
        checkpointTitle: 'Delegated work update started',
      };
    }

    if (
      descriptorHasCapability(descriptor, 'monitor') ||
      descriptorHasCapability(descriptor, 'wait')
    ) {
      return {
        title: 'Monitoring delegated work',
        checkpointTitle: 'Delegated work monitoring active',
      };
    }

    return {
      title: 'Coordinating delegated work',
      checkpointTitle: 'Delegated work coordination active',
    };
  }

  if (
    descriptorHasCapability(descriptor, 'monitor') ||
    descriptorHasCapability(descriptor, 'wait') ||
    descriptorHasWorkflowStage(descriptor, 'monitor_external_execution') ||
    descriptorHasWorkflowStage(descriptor, 'await_external_execution')
  ) {
    return {
      title: 'Monitoring asynchronous work',
      checkpointTitle: 'Async monitoring active',
    };
  }

  return {
    title: `Using ${displayToolName}`,
    checkpointTitle: 'Work started',
  };
}

function getDisplayToolName(toolName: string | undefined): string {
  const normalizedToolName = normalizeToolName(toolName || '');
  return normalizedToolName || toolName || 'tool';
}

export function getToolExecutionCheckpointKind(
  toolName: string | undefined,
): AgentRun['checkpoints'][number]['kind'] {
  const descriptor = readToolDescriptor(toolName);
  return descriptor?.category === 'sessions' ? 'sub-agent' : 'tool';
}

export function buildToolExecutionStartEffect(params: {
  toolName: string | undefined;
  argumentSummary?: string;
  timestamp?: number;
}): ToolExecutionStartEffect {
  const displayToolName = getDisplayToolName(params.toolName);
  return {
    checkpoint: {
      kind: getToolExecutionCheckpointKind(params.toolName),
      title: `Tool started: ${displayToolName}`,
      detail: params.argumentSummary,
      timestamp: params.timestamp,
    },
    workPhase: buildToolExecutionWorkPhasePresentation(params.toolName),
    logEntry: {
      kind: 'tool',
      title: `Tool started: ${displayToolName}`,
      detail: params.argumentSummary,
      timestamp: params.timestamp,
    },
  };
}

export function buildToolExecutionCompletionEffect(params: {
  toolName: string | undefined;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: string | undefined;
  resultSummary?: string;
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  elapsedLabel?: string;
}): ToolExecutionCompletionEffect {
  const displayToolName = getDisplayToolName(params.toolName);
  const startedDelegatedSession =
    params.status !== 'failed' &&
    toolCallStartedDelegatedSession({
      toolName: params.toolName,
      result: params.result,
    });
  const workPhaseDetail =
    params.resultSummary ||
    (params.status === 'failed'
      ? `Tool ${displayToolName} failed`
      : `Completed ${displayToolName}`);
  const titlePrefix = params.status === 'failed' ? 'Tool failed' : 'Tool completed';

  return {
    checkpoint: {
      kind: getToolExecutionCheckpointKind(params.toolName),
      title: `${titlePrefix}: ${displayToolName}`,
      detail: workPhaseDetail,
      timestamp: params.completedAt ?? params.updatedAt,
    },
    workPhaseDetail,
    logEntry: {
      kind: 'tool',
      level: params.status === 'failed' ? 'error' : 'success',
      title: `${titlePrefix}: ${displayToolName}${params.elapsedLabel ? ` (${params.elapsedLabel})` : ''}`,
      detail: params.resultSummary,
      timestamp: params.completedAt ?? params.updatedAt,
    },
    startedDelegatedSession,
  };
}

function toolResultIncludesSessionId(result: string | undefined): boolean {
  if (!result) {
    return false;
  }

  try {
    const parsed = JSON.parse(result) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }

    const sessionId = (parsed as { sessionId?: unknown }).sessionId;
    return typeof sessionId === 'string' && sessionId.trim().length > 0;
  } catch {
    return false;
  }
}

export function toolCallStartedDelegatedSession(params: {
  toolName: string | undefined;
  result: string | undefined;
}): boolean {
  const descriptor = readToolDescriptor(params.toolName);
  return (
    descriptor?.category === 'sessions' &&
    descriptorHasWorkflowStage(descriptor, 'start_external_execution') &&
    toolResultIncludesSessionId(params.result)
  );
}
