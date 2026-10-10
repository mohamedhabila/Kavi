import {
  getAgentControlGraphTurnDirectives,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import { buildAgentControlGraphTurnDirectivesRecordedEvent } from '../../src/engine/graph/turnDirectives';
import {
  createInitialAgentRunControlGraphState,
  normalizeAgentRunControlGraphState,
} from '../../src/services/agents/agentControlGraphState';

// The foreground work window forces a checkpoint turn that reports what was done and asks
// whether to continue. Its reason was missing from the hand-kept list the graph normalizes
// against, so the engine read it back as no reason — the checkpoint got the generic
// "answer from gathered evidence" prompt — and the stored run lost it, so the one-tap
// Continue offered on a checkpoint stop could never appear.

describe('a forced-text reason survives the graph', () => {
  it('keeps the foreground checkpoint through the engine reducer', () => {
    const snapshot = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState(),
      [
        buildAgentControlGraphTurnDirectivesRecordedEvent(
          { forceFinalText: true, forcedTextReason: 'foreground_budget_checkpoint' },
          'foreground_budget_checkpoint',
        ),
      ],
    );

    expect(getAgentControlGraphTurnDirectives(snapshot).forcedTextReason).toBe(
      'foreground_budget_checkpoint',
    );
  });

  it('keeps it in the run the chat store holds', () => {
    const stored = normalizeAgentRunControlGraphState({
      ...createInitialAgentRunControlGraphState(),
      turnDirectives: {
        forceFinalText: true,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
        forcedTextReason: 'foreground_budget_checkpoint',
      },
    });

    expect(stored?.turnDirectives?.forcedTextReason).toBe('foreground_budget_checkpoint');
  });

  it('reads a reason it does not know as no reason', () => {
    const stored = normalizeAgentRunControlGraphState({
      ...createInitialAgentRunControlGraphState(),
      turnDirectives: {
        forceFinalText: true,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
        forcedTextReason: 'persistent_context_settled' as never,
      },
    });

    expect(stored?.turnDirectives?.forcedTextReason).toBeUndefined();
  });
});
