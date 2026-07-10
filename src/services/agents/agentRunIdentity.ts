export type AgentRunIdentity = {
  conversationId: string;
  runId: string;
};

export function createAgentRunIdentityKey(identity: AgentRunIdentity): string {
  const conversationId = identity.conversationId.trim();
  const runId = identity.runId.trim();
  if (!conversationId) {
    throw new Error('Agent run conversationId must not be empty.');
  }
  if (!runId) {
    throw new Error('Agent run runId must not be empty.');
  }

  return `${conversationId.length}:${conversationId}${runId.length}:${runId}`;
}
