import {
  cancelSubAgent,
  getSubAgent,
  getSubAgentsByParent,
} from '../../services/agents/subAgent';

export async function executeSessionCancel(args: {
  sessionId: string;
  reason?: string;
}): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) {
    return `Error: session not found: ${args.sessionId}`;
  }

  if (agent.status !== 'running') {
    return JSON.stringify({
      status: agent.status,
      sessionId: args.sessionId,
      message: 'Session is already in a terminal state.',
      outputPreview: agent.output?.slice(0, 1000),
    });
  }

  const cancelled = cancelSubAgent(args.sessionId, args.reason);
  return JSON.stringify({
    status: 'cancel_requested',
    sessionId: args.sessionId,
    currentActivity: cancelled?.currentActivity,
    message:
      'Cancellation requested. Wait for the worker to reach a terminal state with sessions_wait, then respawn with corrected instructions if needed.',
    canRespawn: true,
  });
}

export async function executeSessionYield(
  args: {
    message?: string;
  },
  conversationId: string,
): Promise<string> {
  const message =
    typeof args.message === 'string' && args.message.trim()
      ? args.message.trim()
      : 'Supervisor checkpoint recorded.';

  const runningAgents = getSubAgentsByParent(conversationId).filter(
    (agent) => agent.status === 'running',
  );
  if (runningAgents.length === 0) {
    return JSON.stringify({
      status: 'completed',
      message,
      finalizeSupervisor: true,
      pendingSessions: [],
      guidance:
        'No running sub-agent sessions remain for this conversation. Finalize the supervisor response instead of waiting again.',
    });
  }

  return JSON.stringify({
    status: 'checkpointed',
    message,
    autoResumeSupported: false,
    finalizeSupervisor: false,
    guidance:
      'sessions_yield records a checkpoint while sub-agents are still running. Continue monitoring with sessions_wait until workers reach a terminal state, or cancel misdirected workers with sessions_cancel.',
    pendingSessions: runningAgents.map((agent) => ({
      sessionId: agent.sessionId,
      ...(agent.workstreamId ? { workstreamId: agent.workstreamId } : {}),
      name: agent.name,
      status: agent.status,
      currentActivity: agent.currentActivity,
      activeToolName: agent.activeToolName,
      idleMs: Math.max(0, Date.now() - (agent.lastProgressAt || agent.updatedAt || agent.startedAt)),
      hasOutput: Boolean(agent.output),
    })),
  });
}
