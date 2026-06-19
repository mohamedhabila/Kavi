import {
  AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE,
  AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL,
  AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_TITLE,
  buildAgentControlGraphFinalDeliveryResolution,
  getAgentControlGraphFinalReportTitle,
} from '../../src/engine/graph/finalDelivery';
import {
  AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_TITLE,
  buildAgentControlGraphFinalReviewGate,
} from '../../src/engine/graph/finalReviewGate';

describe('agent control graph final delivery helpers', () => {
  it('keeps final response synthesis copy in the graph boundary', () => {
    expect(AGENT_CONTROL_GRAPH_FINAL_RESPONSE_CHECKPOINT_TITLE).toBe('Final response delivered');
    expect(AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_TITLE).toBe(
      'Final response synthesis started',
    );
    expect(AGENT_CONTROL_GRAPH_FINAL_RESPONSE_SYNTHESIS_DETAIL).toBe(
      'Synthesizing final response from verified results.',
    );
  });

  it('maps terminal outcomes to final report titles', () => {
    expect(getAgentControlGraphFinalReportTitle('completed')).toBe('Final response delivered');
    expect(getAgentControlGraphFinalReportTitle('cancelled')).toBe(
      'Cancellation report delivered',
    );
    expect(getAgentControlGraphFinalReportTitle('failed')).toBe('Failure report delivered');
  });

  it('maps terminal blockers to blocker report titles', () => {
    expect(getAgentControlGraphFinalReportTitle('failed', 'terminal_blocked')).toBe(
      'Blocker report delivered',
    );
    expect(getAgentControlGraphFinalReportTitle('failed', 'terminal_review_unavailable')).toBe(
      'Blocker report delivered',
    );
    expect(getAgentControlGraphFinalReportTitle('failed', 'missing_required_side_effect')).toBe(
      'Blocker report delivered',
    );
    expect(getAgentControlGraphFinalReportTitle('failed', 'route_blocked')).toBe(
      'Blocker report delivered',
    );
  });

  it('allows final review for any user-facing assistant candidate with visible text', () => {
    expect(
      buildAgentControlGraphFinalReviewGate({
        candidateMessage: {
          role: 'assistant',
          content: 'Final answer.',
          assistantMetadata: { kind: 'final', completionStatus: 'complete' },
        },
      }),
    ).toEqual({ type: 'ready', candidatePreview: 'Final answer.' });

    expect(
      buildAgentControlGraphFinalReviewGate({
        candidateMessage: {
          role: 'assistant',
          content: 'Draft answer from a tool turn.',
          toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}', status: 'completed' }],
          assistantMetadata: { kind: 'intermediate', completionStatus: 'complete' },
        },
      }),
    ).toEqual({ type: 'ready', candidatePreview: 'Draft answer from a tool turn.' });
  });

  it('defers final review when the final candidate is missing or empty', () => {
    expect(buildAgentControlGraphFinalReviewGate({}).type).toBe('recover');

    const emptyGate = buildAgentControlGraphFinalReviewGate({
      candidateMessage: {
        role: 'assistant',
        content: '   ',
        assistantMetadata: { kind: 'final', completionStatus: 'complete' },
      },
    });

    expect(emptyGate).toEqual(
      expect.objectContaining({
        type: 'recover',
        reason: 'empty_final_candidate',
        checkpointTitle: AGENT_CONTROL_GRAPH_FINAL_REVIEW_RECOVERY_TITLE,
        systemPrompt: expect.stringContaining('required_output: visible_user_answer'),
      }),
    );
  });

  it('resolves final delivery summaries from recovered preview, fallback, or checkpoint', () => {
    expect(
      buildAgentControlGraphFinalDeliveryResolution({
        status: 'completed',
        finalPreview: 'Recovered final.',
        latestSummary: 'Pilot summary.',
        checkpointDetail: 'Pilot detail.',
      }),
    ).toEqual({ type: 'use_recovered_preview', latestSummary: 'Recovered final.' });

    expect(
      buildAgentControlGraphFinalDeliveryResolution({
        status: 'completed',
        checkpointDetail: 'Pilot detail.',
      }),
    ).toEqual({
      type: 'insert_missing_final_response_fallback',
      completionStatus: 'complete',
      finishReason: 'fallback_missing_final_response',
    });

    expect(
      buildAgentControlGraphFinalDeliveryResolution({
        status: 'failed',
        latestSummary: '',
        checkpointDetail: 'Blocked detail.',
      }),
    ).toEqual({ type: 'use_checkpoint_summary', latestSummary: 'Blocked detail.' });
  });

  it('defers final review for non-user-facing assistant artifacts', () => {
    expect(
      buildAgentControlGraphFinalReviewGate({
        candidateMessage: {
          role: 'assistant',
          content: 'Worker event',
          assistantMetadata: { kind: 'final', completionStatus: 'incomplete' },
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'sub-1',
              parentConversationId: 'conv-1',
              depth: 0,
              startedAt: 1,
              updatedAt: 2,
              status: 'completed',
              sandboxPolicy: 'inherit',
            },
          },
        },
      }),
    ).toEqual(expect.objectContaining({ type: 'recover', reason: 'non_plain_final_candidate' }));
  });
});
