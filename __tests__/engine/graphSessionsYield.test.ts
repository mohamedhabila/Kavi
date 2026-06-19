import {
  buildAgentControlGraphSessionsYieldCompletionNote,
  parseAgentControlGraphSessionsYieldResult,
  trimAgentControlGraphPendingToolCallsAfterYield,
} from '../../src/engine/graph/sessionsYield';

describe('agent control graph sessions-yield helpers', () => {
  it('forces final text only for completed supervise-safe sessions_yield result', () => {
    const result = parseAgentControlGraphSessionsYieldResult(
      'sessions_yield',
      JSON.stringify({
        status: 'completed',
        finalizeSupervisor: true,
        message: 'all workers done',
      }),
    );

    expect(result).toEqual({
      yielded: false,
      message: 'all workers done',
      forceFinalText: true,
    });
  });

  it('treats checkpointed sessions_yield as continuation', () => {
    const result = parseAgentControlGraphSessionsYieldResult(
      'sessions_yield',
      JSON.stringify({
        status: 'checkpointed',
        message: 'waiting for terminalization',
      }),
    );

    expect(result).toEqual({ yielded: false });
  });

  it('ignores parse errors as non-finalization', () => {
    expect(parseAgentControlGraphSessionsYieldResult('sessions_yield', 'not-json')).toEqual({
      yielded: false,
    });
    expect(parseAgentControlGraphSessionsYieldResult('read_file', '{}')).toEqual({ yielded: false });
  });

  it('trims tool calls after the first sessions_yield', () => {
    const trimmed = trimAgentControlGraphPendingToolCallsAfterYield([
      { id: '1', name: 'read_file', arguments: '{}' },
      { id: '2', name: 'sessions_yield', arguments: '{}' },
      { id: '3', name: 'read_file', arguments: '{}' },
    ]);

    expect(trimmed).toHaveLength(2);
    expect(trimmed.map((toolCall) => toolCall.id)).toEqual(['1', '2']);
  });

  it('builds a completion finalization note', () => {
    const note = buildAgentControlGraphSessionsYieldCompletionNote('done');
    expect(note).toContain('[SYSTEM FINAL DELIVERY]');
    expect(note).toContain('Background sessions are terminal.');
    expect(note).toContain('Supervisor note: done');
  });
});
