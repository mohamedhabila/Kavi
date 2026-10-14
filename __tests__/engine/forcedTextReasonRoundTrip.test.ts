import {
  getAgentControlGraphTurnDirectives,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';
import { buildAgentControlGraphTurnDirectivesRecordedEvent } from '../../src/engine/graph/turnDirectives';
import {
  createInitialAgentRunControlGraphState,
  normalizeAgentRunControlGraphState,
} from '../../src/services/agents/agentControlGraphState';

// A forced text-only turn carries the reason that picks its prompt. A reason missing from
// the hand-kept list the graph normalizes against was read back as no reason — the turn
// got the generic "answer from gathered evidence" prompt — and the stored run lost it.

describe('a forced-text reason survives the graph', () => {
  it('keeps a background handoff through the engine reducer', () => {
    const snapshot = reduceAgentControlGraph(
      createInitialAgentRunControlGraphState(),
      [
        buildAgentControlGraphTurnDirectivesRecordedEvent(
          { forceFinalText: true, forcedTextReason: 'background_session_started' },
          'background_session_started',
        ),
      ],
    );

    expect(getAgentControlGraphTurnDirectives(snapshot).forcedTextReason).toBe(
      'background_session_started',
    );
  });

  it('keeps it in the run the chat store holds', () => {
    const stored = normalizeAgentRunControlGraphState({
      ...createInitialAgentRunControlGraphState(),
      turnDirectives: {
        forceFinalText: true,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
        forcedTextReason: 'background_session_started',
      },
    });

    expect(stored?.turnDirectives?.forcedTextReason).toBe('background_session_started');
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
