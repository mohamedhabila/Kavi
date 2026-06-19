import type { Attachment } from '../../types/attachment';
import type { Message, ToolCall } from '../../types/message';
import {
  getSubAgent,
  listActiveSubAgents,
  getSessionContext,
} from '../../services/agents/subAgent';
import { createSurfacedSubAgentOutputPayload } from '../../services/agents/surfacedSubAgentOutput';
import { selectRecentSubAgentEvidenceActivity } from '../../services/agents/subAgentEvidence';
import { stripAttachmentPayloads } from '../../utils/messageAttachments';
import { TERMINAL_SESSION_OUTPUT_GUIDANCE } from './builtin-session-resultSupport';

type SessionHistoryMessage = {
  role: Message['role'] | 'system';
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolCalls?: Array<Pick<ToolCall, 'id' | 'name' | 'status'>>;
  attachments?: Attachment[];
};

function buildSessionHistoryMessage(message: Message): SessionHistoryMessage {
  return {
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments?.length
      ? { attachments: stripAttachmentPayloads(message.attachments) }
      : {}),
    ...(message.toolCalls?.length
      ? {
          toolCalls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            status: toolCall.status,
          })),
        }
      : {}),
  };
}

function serializeSessionHistory(
  history: {
    sessionId: string;
    status: string;
    startedAt: number;
    currentActivity?: string;
    historySource: 'persisted-transcript' | 'activity-log';
    conversationSummary?: string;
    activityLog: Array<{ timestamp: number; kind: string; text: string }>;
    messages: SessionHistoryMessage[];
  },
  maxSize: number,
): string {
  const bounded = {
    ...history,
    activityLog: [...history.activityLog],
    messages: [...history.messages],
  };

  let serialized = JSON.stringify(bounded);
  while (serialized.length > maxSize && bounded.messages.length > 1) {
    bounded.messages.shift();
    serialized = JSON.stringify(bounded);
  }

  while (serialized.length > maxSize && bounded.activityLog.length > 0) {
    bounded.activityLog.shift();
    serialized = JSON.stringify(bounded);
  }

  if (serialized.length > maxSize && bounded.conversationSummary) {
    bounded.conversationSummary = `${bounded.conversationSummary.slice(0, 317).trimEnd()}...`;
    serialized = JSON.stringify(bounded);
  }

  if (serialized.length > maxSize && bounded.messages.length > 0) {
    const lastMessage = bounded.messages[bounded.messages.length - 1];
    bounded.messages = [
      {
        ...lastMessage,
        content: `${lastMessage.content.slice(0, 1021).trimEnd()}...`,
      },
    ];
    serialized = JSON.stringify(bounded);
  }

  return serialized;
}

export async function executeSessionList(): Promise<string> {
  const agents = listActiveSubAgents();
  if (agents.length === 0) {
    return JSON.stringify({
      sessions: [],
      count: 0,
      guidance:
        'No active sessions are available. Reuse any known session ids instead of calling sessions_list again unless the active session set may have changed.',
    });
  }

  return JSON.stringify({
    sessions: agents.map((agent) => ({
      sessionId: agent.sessionId,
      ...(agent.workstreamId ? { workstreamId: agent.workstreamId } : {}),
      name: agent.name,
      parentConversationId: agent.parentConversationId,
      status: agent.status,
      depth: agent.depth,
      startedAt: agent.startedAt,
      launchState: agent.launchState,
      output: agent.output?.slice(0, 500),
      currentActivity: agent.currentActivity,
      activeToolName: agent.activeToolName,
      lastToolResultPreview: agent.lastToolResultPreview,
      artifactCount: agent.artifacts?.length || 0,
      hasDeadline: typeof agent.deadlineAt === 'number',
      deadlineAt: agent.deadlineAt,
      canCancel: agent.status === 'running',
    })),
    count: agents.length,
    guidance:
      'Reuse the returned session ids. Switch to sessions_wait, sessions_output, or sessions_history for a known session instead of calling sessions_list again unless the active session set may have changed.',
  });
}

export async function executeSessionHistory(args: {
  sessionId: string;
  maxMessages?: number;
}): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  const maxSize = 80 * 1024;
  const maxPerMessage = 4000;
  const maxMessages = Math.max(1, Math.floor(args.maxMessages || 8));
  const output = (agent.output || '').slice(0, maxPerMessage);
  const sessionContext = getSessionContext(args.sessionId);
  const activityEntries = agent.activityLog?.slice(-maxMessages) || [];
  const transcriptMessages =
    sessionContext?.messages
      ?.slice(-maxMessages)
      .map((message) => buildSessionHistoryMessage(message)) || [];
  const fallbackMessages: SessionHistoryMessage[] = [
    ...activityEntries.map<SessionHistoryMessage>((entry) => ({
      role: entry.kind === 'message' ? 'assistant' : 'system',
      content: entry.text,
      timestamp: entry.timestamp,
    })),
    ...(output ? [{ role: 'assistant' as const, content: output }] : []),
  ];

  const history = {
    sessionId: args.sessionId,
    status: agent.status,
    startedAt: agent.startedAt,
    currentActivity: agent.currentActivity,
    historySource:
      transcriptMessages.length > 0 ? ('persisted-transcript' as const) : ('activity-log' as const),
    conversationSummary: sessionContext?.conversationSummary || output || undefined,
    activityLog: activityEntries,
    messages: transcriptMessages.length > 0 ? transcriptMessages : fallbackMessages,
  };

  return serializeSessionHistory(history, maxSize);
}

export async function executeSessionOutput(args: { sessionId: string }): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  if (agent.status === 'running') {
    return JSON.stringify({
      sessionId: args.sessionId,
      status: agent.status,
      hasOutput: false,
      guidance:
        'Final output is not available yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or continue with other non-overlapping work until it does.',
    });
  }

  const output = agent.output || '';
  const recentActivity = selectRecentSubAgentEvidenceActivity(agent);
  return JSON.stringify({
    sessionId: args.sessionId,
    status: agent.status,
    hasOutput: output.length > 0,
    output,
    ...(agent.lastToolResultPreview ? { lastToolResultPreview: agent.lastToolResultPreview } : {}),
    ...(recentActivity.length > 0 ? { recentActivity } : {}),
    guidance: TERMINAL_SESSION_OUTPUT_GUIDANCE,
  });
}

export async function executeSessionSurfaceOutput(args: {
  sessionId: string;
  prefix?: string;
  suffix?: string;
  startMarker?: string;
  endMarker?: string;
  includeStartMarker?: boolean;
  includeEndMarker?: boolean;
  maxChars?: number;
  fallbackToFullOutput?: boolean;
  trim?: boolean;
}): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  if (agent.status === 'running') {
    return JSON.stringify({
      sessionId: args.sessionId,
      status: agent.status,
      hasOutput: false,
      guidance:
        'Worker output cannot be surfaced yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or continue with other non-overlapping work until it does.',
    });
  }

  const surfacedResult = createSurfacedSubAgentOutputPayload({
    sessionId: args.sessionId,
    sourceOutput: agent.output || '',
    options: {
      prefix: args.prefix,
      suffix: args.suffix,
      startMarker: args.startMarker,
      endMarker: args.endMarker,
      includeStartMarker: args.includeStartMarker,
      includeEndMarker: args.includeEndMarker,
      maxChars: args.maxChars,
      fallbackToFullOutput: args.fallbackToFullOutput,
      trim: args.trim,
    },
  });

  if (surfacedResult.error || !surfacedResult.payload) {
    return JSON.stringify({
      status: 'error',
      sessionId: args.sessionId,
      error: surfacedResult.error || 'Unable to surface worker output.',
    });
  }

  return JSON.stringify(surfacedResult.payload);
}
