// ---------------------------------------------------------------------------
// Tests - Orchestrator: a run resumed while its background workers still run
// ---------------------------------------------------------------------------
// A run resumed while it waits on background workers (an explicit resume of that run) went
// through an entry decision policy that read the open work as "wait" and forced a tool-less
// turn ("State what is still pending ... no verified completion is available yet"), so the
// model could not check on its workers or act on the conversation. Pending operations whose
// monitor tools needed approval, or were not allowed, forced "consent" and "decline" turns
// the same way.

import {
  runOrchestrator,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';
import { createInitialAgentControlGraphSnapshot } from '../../../src/engine/graph/agentControlGraph';

describe('a run resumed while its background workers still run', () => {
  it('keeps its tools, so the model can check on its workers itself', async () => {
    mockStreamMessage.mockImplementation(() =>
      createStreamGenerator(
        [
          { type: 'token', content: 'Both workers are still running.' },
          { type: 'done', content: 'Both workers are still running.' },
        ],
        'text',
      ),
    );

    const options: OrchestratorOptions = {
      provider: makeProvider(),
      model: 'gpt-5.4',
      conversationId: 'conv-resume-waiting-workers',
      systemPrompt: 'You are helpful',
      messages: [
        { id: 'msg1', role: 'user', content: 'Research both vendors.', timestamp: 1 },
        { id: 'msg2', role: 'user', content: 'How far along are they?', timestamp: 2 },
      ],
      initialAgentControlGraphState: createInitialAgentControlGraphSnapshot({
        status: 'waiting_async',
        asyncWork: { awaitingBackgroundWorkers: true, pendingOperations: [], updatedAt: 1 },
      }),
    };

    await runOrchestrator(options, makeCallbacks());

    const firstCallOptions = mockStreamMessage.mock.calls[0][1];
    expect((firstCallOptions.tools ?? []).length).toBeGreaterThan(0);
    const systemText = JSON.stringify(mockStreamMessage.mock.calls[0][0]);
    expect(systemText).not.toContain('SYSTEM WAITING FOR VERIFIED RESULT');
  });
});
