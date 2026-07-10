import {
  createInitialAgentControlGraphSnapshot,
  createStreamGenerator,
  getPersona,
  makeCallbacks,
  makeProvider,
  mockStreamMessage,
  runOrchestrator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';

describe('orchestrator request decision integration', () => {
  it('uses the code-owned wait decision for an explicit background-only resume', async () => {
    jest.mocked(getPersona).mockReturnValue({
      id: 'super-agent',
      name: 'Agent',
      description: 'Agentic assistant',
      systemPrompt: '',
      icon: 'sparkles',
      color: '#000000',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    mockStreamMessage.mockReturnValue(
      createStreamGenerator([
        { type: 'token', content: 'The worker result is still pending.' },
        { type: 'done' },
      ]),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId: 'conv-request-wait-resume',
      personaId: 'super-agent',
      taskId: null,
      systemPrompt: 'You are helpful',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Complete the delegated research.',
          timestamp: 1,
        },
      ],
      initialAgentControlGraphState: createInitialAgentControlGraphSnapshot({
        status: 'waiting_async',
        asyncWork: {
          awaitingBackgroundWorkers: true,
          pendingOperations: [],
          updatedAt: 10,
        },
        updatedAt: 10,
      }),
    };

    await runOrchestrator(options, callbacks);

    const firstRequestMessages = mockStreamMessage.mock.calls[0][0] as Array<{
      role: string;
      content?: string;
    }>;
    const firstRequestOptions = mockStreamMessage.mock.calls[0][1] as {
      tools?: unknown;
    };
    expect(firstRequestMessages[0]?.content).toContain('[SYSTEM WAITING FOR VERIFIED RESULT]');
    expect(firstRequestOptions.tools).toBeUndefined();
    expect(callbacks.getVisibleTokenText()).toBe('The worker result is still pending.');
  });
});
