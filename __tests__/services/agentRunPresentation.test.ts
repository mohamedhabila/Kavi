import {
  buildAgentRunSummaryText,
  extractToolNameFromCheckpointTitle,
  formatAgentRunCheckpointKind,
  formatAgentRunStatusLabel,
  getAgentRunDisplayPhase,
  getLatestAgentRunToolCheckpoint,
} from '../../src/services/agents/agentRunPresentation';

describe('agentRunPresentation', () => {
  it('formats agent run status labels', () => {
    expect(formatAgentRunStatusLabel('completed')).toBe('Completed');
    expect(formatAgentRunStatusLabel('failed')).toBe('Failed');
    expect(formatAgentRunStatusLabel('cancelled')).toBe('Cancelled');
    expect(formatAgentRunStatusLabel('running')).toBe('Running');
  });

  it('builds summary text from the available counters', () => {
    expect(buildAgentRunSummaryText()).toBeUndefined();
    expect(
      buildAgentRunSummaryText({
        assistantTurns: 2,
        startedTools: 4,
        completedTools: 3,
        failedTools: 1,
        spawnedSubAgents: 2,
        durationMs: 65_000,
      }),
    ).toBe('Turns 2 · Tools 3/4 · Failed 1 · Workers 2 · 1m 5s');
  });

  it('formats checkpoint kinds for presentation', () => {
    expect(formatAgentRunCheckpointKind('phase')).toBe('Phase');
    expect(formatAgentRunCheckpointKind('tool')).toBe('Tool');
    expect(formatAgentRunCheckpointKind('sub-agent')).toBe('Worker');
    expect(formatAgentRunCheckpointKind('note')).toBe('Note');
    expect(formatAgentRunCheckpointKind('run')).toBe('Run');
  });

  it('chooses the best display phase for an agent run', () => {
    expect(getAgentRunDisplayPhase({ phases: [] } as any)).toBeUndefined();

    expect(
      getAgentRunDisplayPhase({
        currentPhase: 'review',
        phases: [
          { key: 'plan', title: 'Plan', status: 'completed' },
          { key: 'work', title: 'Work', status: 'active' },
        ],
      } as any)?.key,
    ).toBe('work');

    expect(
      getAgentRunDisplayPhase({
        currentPhase: 'review',
        phases: [
          { key: 'plan', title: 'Plan', status: 'completed' },
          { key: 'review', title: 'Review', status: 'pending' },
        ],
      } as any)?.key,
    ).toBe('review');

    expect(
      getAgentRunDisplayPhase({
        currentPhase: 'work',
        phases: [
          { key: 'plan', title: 'Plan', status: 'completed' },
          { key: 'review', title: 'Review', status: 'failed' },
        ],
      } as any)?.key,
    ).toBe('review');

    expect(
      getAgentRunDisplayPhase({
        currentPhase: 'work',
        phases: [
          { key: 'assess', title: 'Assess', status: 'pending' },
          { key: 'work', title: 'Work', status: 'pending' },
        ],
      } as any)?.key,
    ).toBe('work');
  });

  it('returns the latest tool checkpoint when present', () => {
    const run = {
      checkpoints: [
        { kind: 'note', title: 'Started' },
        { kind: 'tool', title: 'Tool: read_file' },
        { kind: 'tool', title: 'Tool: write_file' },
      ],
    } as any;

    expect(getLatestAgentRunToolCheckpoint(run)?.title).toBe('Tool: write_file');
    expect(
      getLatestAgentRunToolCheckpoint({
        checkpoints: [{ kind: 'note', title: 'Only note' }],
      } as any),
    ).toBeUndefined();
  });

  it('extracts tool names from checkpoint titles', () => {
    expect(extractToolNameFromCheckpointTitle('')).toBeUndefined();
    expect(extractToolNameFromCheckpointTitle('Tool: read_file')).toBe('read_file');
    expect(extractToolNameFromCheckpointTitle('Tool completed: sessions_wait')).toBe(
      'sessions_wait',
    );
    expect(extractToolNameFromCheckpointTitle('Run complete')).toBeUndefined();
  });
});
