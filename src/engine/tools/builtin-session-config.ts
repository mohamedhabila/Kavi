import { generateId } from '../../utils/id';
import type { Message } from '../../types/message';
import type { SubAgentConfig } from '../../types/subAgent';

function normalizeSessionDepthValue(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

/** The depth a session is already running at, from the snapshot or its stored config. */
function resolveSessionDepth(
  session: { depth?: unknown } | undefined,
  context: { config?: { depth?: unknown } } | undefined,
): number | undefined {
  return (
    normalizeSessionDepthValue(session?.depth) ??
    normalizeSessionDepthValue(context?.config?.depth)
  );
}

/** Depth for a worker spawned *by* this session: one level further from the user. */
export function resolveChildSessionDepth(
  session: { depth?: unknown } | undefined,
  context: { config?: { depth?: unknown } } | undefined,
): number | undefined {
  const depth = resolveSessionDepth(session, context);
  return depth == null ? undefined : depth + 1;
}

/**
 * Depth for a follow-up *to* an existing session: unchanged, because nothing nested.
 *
 * `sessions_send` continues a worker that already exists — same session, same place in the
 * hierarchy — but it used to reuse the child-depth rule and count every follow-up as one
 * level deeper. With MAX_SPAWN_DEPTH at 2 that gave a worker exactly one follow-up before
 * the ceiling refused it, and the refusal blamed spawn depth for a call that spawns
 * nothing.
 *
 * Traced on-device: a worker launched at depth 1, the first sessions_send ran at depth 2,
 * and the second was rejected with "Max spawn depth 2 exceeded" — while the supervisor was
 * simply asking the same worker to finish writing its report. Nothing was ever nested; the
 * counter only ratcheted.
 *
 * The ceiling still binds where it means something: `resolveChildSessionDepth` above keeps
 * incrementing, so a worker that spawns its own worker is still stopped at the same limit.
 */
export function resolveFollowUpSessionDepth(
  session: { depth?: unknown } | undefined,
  context: { config?: { depth?: unknown } } | undefined,
): number | undefined {
  return resolveSessionDepth(session, context);
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
  deliverableKind?: SubAgentConfig['deliverableKind'];
  sanitizedName?: string;
  workerTools?: string[];
  memorySelectionScope?: SubAgentConfig['memorySelectionScope'];
  memoryBundle?: SubAgentConfig['memoryBundle'];
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
    ...(args.deliverableKind ? { deliverableKind: args.deliverableKind } : {}),
    name: args.sanitizedName,
    tools: args.workerTools,
    memorySelectionScope: args.memorySelectionScope,
    memoryBundle: args.memoryBundle,
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
  memorySelectionScope?: SubAgentConfig['memorySelectionScope'];
  memoryBundle?: SubAgentConfig['memoryBundle'];
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
    memorySelectionScope: args.memorySelectionScope,
    memoryBundle: args.memoryBundle,
    linkUnderstandingEnabled: args.linkUnderstandingEnabled,
    mediaUnderstandingEnabled: args.mediaUnderstandingEnabled,
  };
}
