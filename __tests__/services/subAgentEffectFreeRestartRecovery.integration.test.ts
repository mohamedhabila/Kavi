jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  detectOrphans,
  getSubAgent,
  installSubAgentDurabilityHarness,
  mockProvider,
  REGISTRY_CONTEXTS_KEY,
  REGISTRY_KEY,
  runOrchestrator,
  type ActiveSubAgent,
  writePersistedJson,
} from '../helpers/subAgentDurabilityHarness';

installSubAgentDurabilityHarness();

describe('effect-free sub-agent restart recovery', () => {
  it('resumes a compacted read-only worker from a completed tool-batch checkpoint', async () => {
    const now = Date.now();
    const sessionId = 'read-restart-1';
    const prompt = 'Inspect every source file and report only evidence you can re-read.';
    const runningAgent: ActiveSubAgent = {
      sessionId,
      parentConversationId: 'conversation-read-restart',
      depth: 0,
      startedAt: now - 120_000,
      updatedAt: now - 2_000,
      status: 'running',
      sandboxPolicy: 'safe-only',
      iterations: 67,
      toolsUsed: ['read_file'],
    };

    await writePersistedJson(REGISTRY_KEY, [runningAgent]);
    await writePersistedJson(REGISTRY_CONTEXTS_KEY, {
      [sessionId]: {
        config: {
          parentConversationId: 'conversation-read-restart',
          prompt,
          sandboxPolicy: 'safe-only',
          tools: ['read_file'],
        },
        provider: {
          ...mockProvider,
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
        },
        systemPrompt: 'You are a focused worker.',
        conversationSummary: 'One source reached EOF; three still require verified reads.',
        transcriptRetainedFromStart: false,
        messages: [
          {
            id: 'orphan-tool',
            role: 'tool',
            content: '{}',
            toolCallId: 'orphan-call',
            timestamp: now - 4_000,
          },
          {
            id: 'assistant-read',
            role: 'assistant',
            content: '',
            timestamp: now - 3_000,
            toolCalls: [
              {
                id: 'read-call',
                name: 'read_file',
                arguments: '{"path":"attachments/runtime.txt","offset":4096}',
                status: 'pending',
              },
            ],
          },
          {
            id: 'tool-read',
            role: 'tool',
            content:
              '{"status":"read_chunk","path":"attachments/runtime.txt","offset":4096,"totalChars":12000,"complete":false}',
            toolCallId: 'read-call',
            timestamp: now - 2_500,
          },
        ],
      },
    });
    (runOrchestrator as jest.Mock).mockImplementation(() => new Promise(() => undefined));

    await expect(detectOrphans()).resolves.toBe(0);
    for (
      let attempt = 0;
      attempt < 20 && !(runOrchestrator as jest.Mock).mock.calls.length;
      attempt += 1
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
    }

    expect(runOrchestrator).toHaveBeenCalledTimes(1);
    const resumedMessages = (runOrchestrator as jest.Mock).mock.calls[0][0].messages;
    expect(resumedMessages[0]).toMatchObject({ role: 'user', content: prompt });
    expect(resumedMessages.some((message: { id: string }) => message.id === 'orphan-tool')).toBe(
      false,
    );
    expect(resumedMessages.at(-1)?.content).toContain(
      'retained summary and durable read checkpoints as orientation only, not as proof',
    );
    expect(getSubAgent(sessionId)).toMatchObject({
      status: 'running',
      iterations: 67,
      toolsUsed: ['read_file'],
    });
  });
});
