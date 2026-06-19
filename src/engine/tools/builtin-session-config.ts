import { generateId } from '../../utils/id';
import type { Message } from '../../types/message';
import type { SubAgentConfig } from '../../types/subAgent';

function normalizeSessionDepthValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

export function resolveChildSessionDepth(
  session: { depth?: unknown } | undefined,
  context: { config?: { depth?: unknown } } | undefined,
): number | undefined {
  const sessionDepth = normalizeSessionDepthValue(session?.depth);
  if (sessionDepth != null) {
    return sessionDepth + 1;
  }

  const contextDepth = normalizeSessionDepthValue(context?.config?.depth);
  if (contextDepth != null) {
    return contextDepth + 1;
  }

  return undefined;
}

export function sanitizeWorkerName(name?: unknown): string | undefined {
  if (typeof name !== 'string' || !name) {
    return undefined;
  }

  return (
    name
      .slice(0, 256)
      .replace(/[\x00-\x1f\x7f]/g, '_')
      .trim() || undefined
  );
}

export function buildSpawnSubAgentConfig(args: {
  parentConversationId: string;
  workspaceConversationId: string;
  workspaceReadFallbackConversationId?: string;
  parentSessionId?: string;
  childDepth?: number;
  workerPrompt: string;
  initialMessages?: Message[];
  workerModel: string;
  agentRunId?: string;
  workstreamId?: string;
  sanitizedName?: string;
  workerTools?: string[];
  linkUnderstandingEnabled: boolean;
  mediaUnderstandingEnabled: boolean;
}): SubAgentConfig {
  return {
    parentConversationId: args.parentConversationId,
    ...(args.parentSessionId ? { parentSessionId: args.parentSessionId } : {}),
    ...(args.childDepth != null ? { depth: args.childDepth } : {}),
    prompt: args.workerPrompt,
    ...(args.initialMessages ? { initialMessages: args.initialMessages } : {}),
    workspaceConversationId: args.workspaceConversationId,
    ...(args.workspaceReadFallbackConversationId
      ? {
          workspaceReadFallbackConversationId: args.workspaceReadFallbackConversationId,
        }
      : {}),
    model: args.workerModel,
    ...(args.agentRunId ? { agentRunId: args.agentRunId } : {}),
    ...(args.workstreamId ? { workstreamId: args.workstreamId } : {}),
    name: args.sanitizedName,
    tools: args.workerTools,
    inheritMemory: false,
    linkUnderstandingEnabled: args.linkUnderstandingEnabled,
    mediaUnderstandingEnabled: args.mediaUnderstandingEnabled,
  };
}

export function buildFollowUpMessages(
  previousMessages: Message[] | undefined,
  message: string,
): Message[] | undefined {
  if (!previousMessages?.length) {
    return undefined;
  }

  return [
    ...previousMessages.map((entry) => ({
      ...entry,
      ...(entry.toolCalls
        ? { toolCalls: entry.toolCalls.map((toolCall) => ({ ...toolCall })) }
        : {}),
    })),
    {
      id: generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
    },
  ];
}

export function buildFollowUpPrompt(args: {
  message: string;
  previousContextExists: boolean;
  previousOutput: string;
  hasFollowUpMessages: boolean;
}): string {
  if (args.hasFollowUpMessages) {
    return args.message;
  }

  if (args.previousContextExists) {
    return `## Previous session summary\n\nYour previous work produced the following summary:\n${args.previousOutput}\n\n## Follow-up instruction\n\n${args.message}`;
  }

  return `Previous conversation output:\n${args.previousOutput}\n\nFollow-up message: ${args.message}`;
}

export function buildFollowUpSubAgentConfig(args: {
  parentConversationId?: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  sessionId: string;
  followUpDepth?: number;
  followUpPrompt: string;
  followUpMessages?: Message[];
  followUpModel: string;
  systemPrompt?: string;
  agentRunId?: string;
  workstreamId?: string;
  name?: string;
  tools?: string[];
  sandboxPolicy?: 'full' | 'safe-only' | 'inherit';
  inheritMemory: boolean;
  linkUnderstandingEnabled: boolean;
  mediaUnderstandingEnabled: boolean;
}): SubAgentConfig {
  return {
    parentConversationId: args.parentConversationId || args.sessionId,
    parentSessionId: args.sessionId,
    ...(args.followUpDepth != null ? { depth: args.followUpDepth } : {}),
    prompt: args.followUpPrompt,
    ...(args.followUpMessages ? { initialMessages: args.followUpMessages } : {}),
    workspaceConversationId: args.workspaceConversationId,
    ...(args.workspaceReadFallbackConversationId
      ? {
          workspaceReadFallbackConversationId: args.workspaceReadFallbackConversationId,
        }
      : {}),
    model: args.followUpModel,
    systemPrompt: args.systemPrompt,
    agentRunId: args.agentRunId,
    workstreamId: args.workstreamId,
    name: args.name,
    tools: args.tools,
    sandboxPolicy: args.sandboxPolicy,
    inheritMemory: args.inheritMemory,
    linkUnderstandingEnabled: args.linkUnderstandingEnabled,
    mediaUnderstandingEnabled: args.mediaUnderstandingEnabled,
  };
}
