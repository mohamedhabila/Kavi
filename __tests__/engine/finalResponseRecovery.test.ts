import {
  buildAgentControlGraphFinalResponseRecoveryDecision,
  hasAgentControlGraphVerifiedFinalizationEvidence,
} from '../../src/engine/graph/finalResponseRecovery';
import type { AgentRunFinalizationEvidence } from '../../src/services/agents/lifecycle/finalizePhaseTypes';

function evidence(overrides: Partial<AgentRunFinalizationEvidence>): AgentRunFinalizationEvidence {
  return {
    originalPrompt: 'Complete the task.',
    transcriptMessages: [],
    lastNonEmptyAssistantContent: '',
    lastSubstantiveResult: '',
    resultPreviews: [],
    toolsUsed: [],
    iterations: 1,
    hasIncompleteToolCalls: false,
    ...overrides,
  };
}

describe('final response recovery graph decision', () => {
  it('recovers when approval-grade tool evidence exists', () => {
    const withEvidence = evidence({
      resultPreviews: [{ sourceName: 'write_file', preview: 'Wrote the requested artifact.' }],
    });

    expect(hasAgentControlGraphVerifiedFinalizationEvidence(withEvidence)).toBe(true);
    expect(
      buildAgentControlGraphFinalResponseRecoveryDecision({
        evidence: withEvidence,
        hasProviderContext: false,
        status: 'completed',
      }),
    ).toEqual({ type: 'recover', reason: 'verified_evidence' });
  });

  it('does not treat coordination-only results as verified deliverable evidence', () => {
    const coordinationOnly = evidence({
      resultPreviews: [{ sourceName: 'sessions_spawn', preview: 'Worker launched.' }],
    });

    expect(hasAgentControlGraphVerifiedFinalizationEvidence(coordinationOnly)).toBe(false);
    expect(
      buildAgentControlGraphFinalResponseRecoveryDecision({
        evidence: coordinationOnly,
        hasProviderContext: false,
        status: 'completed',
      }),
    ).toEqual({ type: 'skip', reason: 'missing_provider_context' });
  });

  it('allows assistant draft synthesis only when provider context is available and tools are settled', () => {
    const assistantDraft = evidence({
      lastNonEmptyAssistantContent: 'Draft answer that needs final recovery.',
    });

    expect(
      buildAgentControlGraphFinalResponseRecoveryDecision({
        evidence: assistantDraft,
        hasProviderContext: true,
        status: 'completed',
      }),
    ).toEqual({ type: 'recover', reason: 'assistant_draft_synthesis' });

    expect(
      buildAgentControlGraphFinalResponseRecoveryDecision({
        evidence: { ...assistantDraft, hasIncompleteToolCalls: true },
        hasProviderContext: true,
        status: 'completed',
      }),
    ).toEqual({ type: 'skip', reason: 'incomplete_tool_calls' });
  });

  it('recovers terminal non-completed runs without requiring synthesis context', () => {
    expect(
      buildAgentControlGraphFinalResponseRecoveryDecision({
        evidence: evidence({}),
        hasProviderContext: false,
        status: 'failed',
      }),
    ).toEqual({ type: 'recover', reason: 'terminal_status' });
  });
});
