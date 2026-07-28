import { didSessionToolStartBackgroundWork } from '../../src/engine/graph/sessionBackgroundHandoff';

describe('background session handoff detection', () => {
  const runningResult = JSON.stringify({ status: 'running', sessionId: 'worker-1' });

  it.each([
    ['sessions_spawn', '{"prompt":"audit","waitForCompletion":false}'],
    ['sessions_send', '{"sessionId":"worker-1","message":"continue"}'],
  ])('recognizes successful non-blocking %s work', (toolName, toolArguments) => {
    expect(
      didSessionToolStartBackgroundWork({
        toolName,
        toolArguments,
        toolResult: runningResult,
      }),
    ).toBe(true);
  });

  it.each([
    {
      toolName: 'sessions_spawn',
      toolArguments: '{"prompt":"audit","waitForCompletion":true}',
      toolResult: runningResult,
    },
    {
      toolName: 'sessions_spawn',
      toolArguments: '{"prompt":"audit"}',
      toolResult: '{"status":"completed","sessionId":"worker-1"}',
    },
    {
      toolName: 'sessions_spawn',
      toolArguments: '{"prompt":"audit"}',
      toolResult: runningResult,
      isError: true,
    },
    {
      toolName: 'read_file',
      toolArguments: '{"path":"packet.md"}',
      toolResult: runningResult,
    },
  ])('rejects a non-handoff outcome %#', (params) => {
    expect(didSessionToolStartBackgroundWork(params)).toBe(false);
  });
});
