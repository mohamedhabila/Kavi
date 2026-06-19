import type { AgentRun } from '../types/agentRun';
import type { ConversationLogEntry } from '../types/conversation';
import type { LocalLlmRuntimeStatus } from '../services/localLlm/types';
import { formatCompactElapsed } from '../services/agents/lifecycle/presentPhase';
import { MAX_LOG_DETAIL_CHARS } from './chatScreenConstants';
import { truncateLogDetail as truncateLogDetailWithDefaultLimit } from '../utils/logDetail';

export function truncateLogDetail(
  value?: string,
  maxLength = MAX_LOG_DETAIL_CHARS,
): string | undefined {
  return truncateLogDetailWithDefaultLimit(value, maxLength);
}

export function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

export function formatUsdCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }
  if (value < 0.0001) {
    return '<$0.0001';
  }
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

export function formatConversationLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatLogKindLabel(kind: ConversationLogEntry['kind']): string {
  switch (kind) {
    case 'state':
      return 'State';
    case 'tool':
      return 'Tool';
    case 'usage':
      return 'Usage';
    case 'compaction':
      return 'Compact';
    case 'command':
      return 'Command';
    case 'error':
      return 'Error';
    default:
      return 'System';
  }
}

export function buildTurnSummaryLogDetail(params: {
  durationMs: number;
  assistantTurns: number;
  startedTools: number;
  completedTools: number;
  failedTools: number;
  spawnedSubAgents: number;
}): string {
  const parts = [
    `duration ${formatCompactElapsed(Math.max(0, params.durationMs))}`,
    `assistant turns ${params.assistantTurns}`,
  ];

  if (params.startedTools > 0) {
    parts.push(`tools ${params.completedTools}/${params.startedTools}`);
  }

  if (params.failedTools > 0) {
    parts.push(`failed ${params.failedTools}`);
  }

  if (params.spawnedSubAgents > 0) {
    parts.push(`sub-agents ${params.spawnedSubAgents}`);
  }

  return parts.join(' · ');
}

export function getAgentRunPhaseForSubAgentEvent(
  _event: 'started' | 'completed' | 'error' | 'cancelled' | 'progress' | 'timeout',
): AgentRun['currentPhase'] {
  return 'work';
}

export function formatLocalRuntimeBadgeLabel(status: LocalLlmRuntimeStatus): string {
  if (status.backendSource === 'observed') {
    return status.fellBackFromRequestedBackend
      ? `${status.activeBackend.toUpperCase()} fallback`
      : status.activeBackend.toUpperCase();
  }

  return `Likely ${status.activeBackend.toUpperCase()}`;
}
