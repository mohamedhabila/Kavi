import {
  installSubAgentTestHarness,
  mockProvider,
  spawnSubAgent,
} from '../helpers/subAgentHarness';

describe('sub-agent adaptive horizon', () => {
  installSubAgentTestHarness();

  it('allows a default worker to complete more than 32 useful tool actions', async () => {
    const { runOrchestrator } = require('../../src/engine/orchestrator');
    runOrchestrator.mockImplementationOnce((options: any, callbacks: any) => {
      for (let index = 0; index < 40; index += 1) {
        const toolCall = {
          id: `read-${index}`,
          name: 'read_file',
          arguments: JSON.stringify({ path: `source-${index}.txt` }),
          status: 'completed',
          result: `Read source-${index}.txt to EOF`,
        };
        callbacks.onToolCallStart?.(toolCall);
        callbacks.onToolCallComplete?.(toolCall);
      }
      callbacks.onAssistantMessage?.('All 40 source files were inspected.', []);
      callbacks.onDone?.();
      expect(options).not.toHaveProperty('maxToolIterations');
      return Promise.resolve({ terminalDisposition: 'final_candidate' });
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conversation-1', prompt: 'Inspect all 40 source files.' },
      mockProvider,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'completed',
        iterations: 40,
        output: 'All 40 source files were inspected.',
      }),
    );
  });
});
