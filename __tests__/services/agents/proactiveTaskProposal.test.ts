import type { AgentRun } from '../../../src/types/agentRun';
import type { Conversation } from '../../../src/types/conversation';
import {
  PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS,
  PROACTIVE_TASK_PROPOSAL_MAX_AGE_MS,
  PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS,
  createProactiveTaskProposalIdentityKey,
  selectProactiveTaskProposal,
  type ProactiveTaskProposalReceipt,
} from '../../../src/services/agents/proactiveTaskProposal';

const NOW = 1_800_000_000_000;
const SOURCE_UPDATED_AT = NOW - 60_000;

function failedRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-failed',
    userMessageId: 'message-user',
    goal: 'Private health and finance task content must never appear in the proposal.',
    status: 'failed',
    createdAt: SOURCE_UPDATED_AT - 10_000,
    updatedAt: SOURCE_UPDATED_AT,
    completedAt: SOURCE_UPDATED_AT,
    currentPhase: 'work',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 0,
      failedTools: 1,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-owner',
    title: 'Private conversation title',
    providerId: 'provider',
    systemPrompt: 'system',
    createdAt: SOURCE_UPDATED_AT - 20_000,
    updatedAt: SOURCE_UPDATED_AT,
    messages: [
      {
        id: 'message-user',
        role: 'user',
        content: 'Private health and finance request.',
        timestamp: SOURCE_UPDATED_AT - 10_000,
      },
      {
        id: 'message-assistant',
        role: 'assistant',
        content: 'I could not finish.',
        timestamp: SOURCE_UPDATED_AT,
      },
    ],
    agentRuns: [failedRun()],
    ...overrides,
  };
}

function select(
  params: {
    conversation?: Conversation;
    now?: number;
    receipt?: ProactiveTaskProposalReceipt;
    presentedThisSession?: boolean;
  } = {},
) {
  const candidateConversation = params.conversation ?? conversation();
  const identityKey = createProactiveTaskProposalIdentityKey({
    conversationId: candidateConversation.id,
    runId: candidateConversation.agentRuns?.at(-1)?.id ?? 'run-failed',
  });
  return selectProactiveTaskProposal({
    conversation: candidateConversation,
    now: params.now ?? NOW,
    receipts: params.receipt && identityKey ? { [identityKey]: params.receipt } : {},
    presentedThisSession: params.presentedThisSession && identityKey ? { [identityKey]: true } : {},
  });
}

function receipt(
  overrides: Partial<ProactiveTaskProposalReceipt> = {},
): ProactiveTaskProposalReceipt {
  return {
    proposalId: 'run-failed',
    conversationId: 'conversation-owner',
    runId: 'run-failed',
    sourceUpdatedAt: SOURCE_UPDATED_AT,
    disposition: 'presented',
    presentationCount: 1,
    lastPresentedAt: NOW - 1_000,
    ...overrides,
  };
}

describe('proactive failed-task proposal selection', () => {
  it('derives a deterministic content-free suggestion from a persisted failed user request', () => {
    const first = select();
    const second = select();

    expect(first).toEqual(second);
    expect(first).toEqual({
      id: 'run-failed',
      identityKey: '18:conversation-owner10:run-failed',
      kind: 'continue_failed_task',
      conversationId: 'conversation-owner',
      runId: 'run-failed',
      sourceUserMessageId: 'message-user',
      sourceUpdatedAt: SOURCE_UPDATED_AT,
    });
    expect(JSON.stringify(first)).not.toContain('health');
    expect(JSON.stringify(first)).not.toContain('finance');
  });

  it('fails closed without exact owner-scoped explicit source evidence', () => {
    expect(select({ conversation: conversation({ id: ' conversation-owner' }) })).toBeUndefined();
    expect(
      select({
        conversation: conversation({
          messages: conversation().messages.map((message) =>
            message.id === 'message-user' ? { ...message, role: 'assistant' as const } : message,
          ),
        }),
      }),
    ).toBeUndefined();
    expect(
      select({
        conversation: conversation({
          messages: conversation().messages.filter((message) => message.id !== 'message-user'),
        }),
      }),
    ).toBeUndefined();
    expect(
      select({
        conversation: conversation({
          messages: [
            ...conversation().messages,
            { id: 'new-user', role: 'user', content: 'I moved on.', timestamp: NOW - 500 },
          ],
        }),
      }),
    ).toBeUndefined();
  });

  it('never proposes completed, cancelled, running, active, future, or stale work', () => {
    for (const status of ['completed', 'cancelled', 'running'] as const) {
      expect(
        select({ conversation: conversation({ agentRuns: [failedRun({ status })] }) }),
      ).toBeUndefined();
    }
    expect(
      select({
        conversation: conversation({ activeAgentRunId: 'run-failed' }),
      }),
    ).toBeUndefined();
    expect(
      select({
        conversation: conversation({
          agentRuns: [
            failedRun({
              updatedAt: NOW + 1,
              completedAt: NOW + 1,
            }),
          ],
        }),
      }),
    ).toBeUndefined();
    expect(
      select({ now: SOURCE_UPDATED_AT + PROACTIVE_TASK_PROPOSAL_MAX_AGE_MS + 1 }),
    ).toBeUndefined();
  });

  it('suppresses persisted dismissal or acceptance and rejects cross-owner receipt collisions', () => {
    expect(
      select({ receipt: receipt({ disposition: 'dismissed', respondedAt: NOW }) }),
    ).toBeUndefined();
    expect(
      select({ receipt: receipt({ disposition: 'accepted', respondedAt: NOW }) }),
    ).toBeUndefined();
    expect(select({ receipt: receipt({ conversationId: 'different-owner' }) })).toBeUndefined();
  });

  it('enforces restart cooldown and a maximum presentation count without hiding the current session', () => {
    expect(select({ receipt: receipt() })).toBeUndefined();
    expect(select({ receipt: receipt(), presentedThisSession: true })).toBeDefined();
    expect(
      select({
        now: NOW + PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS,
        receipt: receipt(),
      }),
    ).toBeDefined();
    expect(
      select({
        now: NOW + PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS,
        receipt: receipt({
          presentationCount: PROACTIVE_TASK_PROPOSAL_MAX_PRESENTATIONS,
        }),
      }),
    ).toBeUndefined();
  });
});
