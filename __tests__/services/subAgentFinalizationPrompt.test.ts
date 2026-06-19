import { buildSubAgentFinalizationPrompt } from '../../src/services/agents/lifecycle/terminalOutputFallback';
import type { Message } from '../../src/types/message';

describe('subAgent finalization prompt', () => {
  it('uses transcript evidence directly without preview or excerpt narration', () => {
    const transcriptMessages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Audit the repository and report the result.',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Running verification tools.',
        timestamp: 2,
        toolCalls: [
          {
            id: 'tc-1',
            name: 'run_tests',
            arguments: '{}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'tool-1',
        role: 'tool',
        content: 'All targeted tests passed and the fix was verified.',
        toolCallId: 'tc-1',
        timestamp: 3,
      },
    ];

    const prompt = buildSubAgentFinalizationPrompt({
      originalPrompt: 'Audit the repository and report the result.',
      transcriptMessages,
      toolsUsed: ['run_tests'],
      iterations: 1,
      finalizationMaxTranscriptMessages: 12,
      finalizationMessageCharLimit: 1800,
      finalizationToolContentCharLimit: 2600,
    });

    expect(prompt).toContain('Finalize this worker run for the supervising agent.');
    expect(prompt).toContain('Execution transcript:');
    expect(prompt).toContain('Assistant (requested tools: run_tests):');
    expect(prompt).toContain(
      'Tool result - tc-1:\nAll targeted tests passed and the fix was verified.',
    );
    expect(prompt).not.toContain('Recent verified findings:');
    expect(prompt).not.toContain('Detailed result excerpt:');
  });
});
