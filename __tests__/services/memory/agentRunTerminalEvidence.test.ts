jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import {
  AGENT_RUN_TERMINAL_EVIDENCE_PREFIX,
  buildAgentRunTerminalEvidence,
  collectAgentRunMemoryEvidence,
  parseAgentRunTerminalEvidence,
} from '../../../src/services/memory/agentRunTerminalEvidence';
import type { AgentRun } from '../../../src/types/agentRun';

function completedRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    goal: 'Create the requested calendar event',
    status: 'completed',
    controlGraph: {
      status: 'finalized',
      observedToolResults: [{ id: 'call-1', name: 'calendar_create_event' }],
      goals: [
        {
          id: 'goal-1',
          title: 'Create event',
          status: 'completed',
          dependencies: [],
          evidence: ['effect_receipt_v2:{}'],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    },
    ...overrides,
  } as AgentRun;
}

describe('agent-run terminal evidence', () => {
  it('encodes and parses only graph-confirmed mobile completion', () => {
    const encoded = buildAgentRunTerminalEvidence(completedRun());

    expect(encoded).toMatch(new RegExp(`^${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}`));
    expect(parseAgentRunTerminalEvidence(encoded!)).toEqual({
      version: 1,
      sourceRunId: 'run-1',
      goal: 'Create the requested calendar event',
      runStatus: 'completed',
      graphStatus: 'finalized',
      platform: 'ios',
      completedBlockingGoalCount: 1,
      observedToolCallIds: ['call-1'],
    });
  });

  it('does not issue terminal proof for incomplete graph or blocking goals', () => {
    expect(
      buildAgentRunTerminalEvidence(
        completedRun({
          controlGraph: {
            ...completedRun().controlGraph!,
            status: 'awaiting_review',
          },
        }),
      ),
    ).toBeNull();
    expect(
      buildAgentRunTerminalEvidence(
        completedRun({
          controlGraph: {
            ...completedRun().controlGraph!,
            goals: [
              {
                ...completedRun().controlGraph!.goals![0]!,
                status: 'active',
              },
            ],
          },
        }),
      ),
    ).toBeNull();
  });

  it('keeps persistent goals non-blocking and appends proof after graph evidence', () => {
    const run = completedRun({
      controlGraph: {
        ...completedRun().controlGraph!,
        goals: [
          completedRun().controlGraph!.goals![0]!,
          {
            id: 'monitor-1',
            title: 'Monitor',
            status: 'active',
            completionPolicy: 'persistent',
            dependencies: [],
            evidence: ['monitor:evidence'],
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    });

    const evidence = collectAgentRunMemoryEvidence(run);

    expect(evidence.slice(0, 2)).toEqual(['effect_receipt_v2:{}', 'monitor:evidence']);
    expect(parseAgentRunTerminalEvidence(evidence[2]!)).toEqual(
      expect.objectContaining({ completedBlockingGoalCount: 1 }),
    );
  });

  it('rejects extra fields and malformed exact identities', () => {
    const encoded = buildAgentRunTerminalEvidence(completedRun())!;
    const parsed = JSON.parse(encoded.slice(AGENT_RUN_TERMINAL_EVIDENCE_PREFIX.length));

    expect(
      parseAgentRunTerminalEvidence(
        `${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}${JSON.stringify({ ...parsed, extra: true })}`,
      ),
    ).toBeNull();
    expect(
      parseAgentRunTerminalEvidence(
        `${AGENT_RUN_TERMINAL_EVIDENCE_PREFIX}${JSON.stringify({
          ...parsed,
          sourceRunId: ' run-1',
        })}`,
      ),
    ).toBeNull();
  });
});
