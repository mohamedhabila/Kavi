import { useProactiveProposalStore } from '../../../src/services/agents/proactiveProposalStore';
import {
  PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS,
  selectProactiveTaskProposal,
  type ProactiveTaskProposal,
} from '../../../src/services/agents/proactiveTaskProposal';

const NOW = 1_800_000_000_000;
const proposal: ProactiveTaskProposal = {
  id: 'run-failed',
  identityKey: '18:conversation-owner10:run-failed',
  kind: 'continue_failed_task',
  conversationId: 'conversation-owner',
  runId: 'run-failed',
  sourceUserMessageId: 'message-user',
  sourceUpdatedAt: NOW - 1_000,
};

describe('proactive proposal persistence state', () => {
  beforeEach(() => {
    useProactiveProposalStore.setState({ receipts: {}, presentedThisSession: {} });
  });

  it('records one idempotent presentation per app session', () => {
    useProactiveProposalStore.getState().markPresented(proposal, NOW);
    useProactiveProposalStore.getState().markPresented(proposal, NOW + 1);

    expect(useProactiveProposalStore.getState().receipts[proposal.identityKey]).toMatchObject({
      disposition: 'presented',
      presentationCount: 1,
      lastPresentedAt: NOW,
    });
    expect(useProactiveProposalStore.getState().presentedThisSession).toEqual({
      [proposal.identityKey]: true,
    });
  });

  it.each(['dismissed', 'accepted'] as const)(
    'persists %s suppression and never reopens it',
    (disposition) => {
      useProactiveProposalStore.getState().markPresented(proposal, NOW);
      useProactiveProposalStore
        .getState()
        [disposition === 'dismissed' ? 'dismiss' : 'accept'](proposal, NOW + 1);
      useProactiveProposalStore
        .getState()
        .markPresented(proposal, NOW + PROACTIVE_TASK_PROPOSAL_COOLDOWN_MS);

      expect(useProactiveProposalStore.getState().receipts[proposal.identityKey]).toMatchObject({
        disposition,
        presentationCount: 1,
        respondedAt: NOW + 1,
      });
    },
  );

  it('fails closed for mismatched or malformed proposal identity', () => {
    useProactiveProposalStore
      .getState()
      .markPresented({ ...proposal, identityKey: 'different-owner-key' }, NOW);
    useProactiveProposalStore.getState().dismiss({ ...proposal, id: 'different-run' }, NOW);

    expect(useProactiveProposalStore.getState().receipts).toEqual({});
  });

  it('treats persisted presentations as a cooldown after restart', () => {
    useProactiveProposalStore.getState().markPresented(proposal, NOW);
    const receipts = useProactiveProposalStore.getState().receipts;
    useProactiveProposalStore.setState({ receipts, presentedThisSession: {} });

    const conversation = {
      id: proposal.conversationId,
      title: 'Private',
      providerId: 'provider',
      systemPrompt: 'system',
      createdAt: NOW - 3_000,
      updatedAt: proposal.sourceUpdatedAt,
      messages: [
        {
          id: proposal.sourceUserMessageId,
          role: 'user' as const,
          content: 'Private request',
          timestamp: NOW - 2_000,
        },
      ],
      agentRuns: [
        {
          id: proposal.runId,
          userMessageId: proposal.sourceUserMessageId,
          goal: 'Private request',
          status: 'failed' as const,
          createdAt: NOW - 2_000,
          updatedAt: proposal.sourceUpdatedAt,
          completedAt: proposal.sourceUpdatedAt,
          currentPhase: 'work' as const,
          phases: [],
          checkpoints: [],
          summary: {
            assistantTurns: 1,
            startedTools: 0,
            completedTools: 0,
            failedTools: 0,
            spawnedSubAgents: 0,
          },
        },
      ],
    };

    expect(
      selectProactiveTaskProposal({
        conversation,
        now: NOW + 1,
        receipts,
        presentedThisSession: {},
      }),
    ).toBeUndefined();
  });
});
