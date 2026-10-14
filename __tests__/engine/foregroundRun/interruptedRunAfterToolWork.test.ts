// ---------------------------------------------------------------------------
// Tests - a foreground run whose stream drops after its tools ran
// ---------------------------------------------------------------------------
// Traced live (GLM 5.3 Flash, retry-glm-mt and surf2-glm-mt): the model stream died after the
// engine's own retry, the interrupted-run recovery read the finished tool work as a completed
// run, and resumed it with tools disabled and "Deliver the user-facing final answer now." The
// model, cut off mid-task, answered without the tools it still needed. These tests drive the
// real outcome resolver, recovery handler, final-preview recovery and final-response writer
// against the real chat store; only the provider (absent) and the run's finalize are stubbed.
// The handler no longer takes a resume at all, so it cannot resume the run.

import { resolveForegroundInterruptedResponseOutcome } from '../../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';
import { handleForegroundInterruptedResponseRecovery } from '../../../src/engine/graph/foregroundRun/interruptedResponseRecovery';
import { recoverForegroundAgentRunFinalPreview } from '../../../src/engine/graph/foregroundRun/finalPreviewRecovery';
import { createInitialAgentControlGraphSnapshot } from '../../../src/engine/graph/agentControlGraph';
import { createAgentRunFinalResponse } from '../../../src/screens/agentRunFinalResponse';
import { useChatStore } from '../../../src/store/useChatStore';
import type { Message } from '../../../src/types/message';

const CONVERSATION_ID = 'conversation-1';
const RUN_ID = 'run-1';
const DRAFT_ID = 'assistant-draft';
const PARTIAL_TEXT = 'The notes say the review moved to';

function seedRunInterruptedAfterToolWork(): void {
  const messages: Message[] = [
    {
      id: 'user-1',
      role: 'user',
      content: 'Read my notes and tell me when the review is.',
      timestamp: 10,
    },
    {
      id: 'assistant-tools',
      role: 'assistant',
      content: '',
      timestamp: 11,
      toolCalls: [
        {
          id: 'tc-1',
          name: 'read_file',
          arguments: '{"path":"notes.md"}',
          status: 'completed',
        },
      ],
      assistantMetadata: {
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'tool_use',
      },
    },
    {
      id: 'tool-1',
      role: 'tool',
      content: 'Design review moved to Friday 14:00.',
      toolCallId: 'tc-1',
      timestamp: 12,
    },
    {
      id: DRAFT_ID,
      role: 'assistant',
      content: PARTIAL_TEXT,
      timestamp: 13,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'response_failed',
      },
    },
  ] as Message[];
  useChatStore.setState({
    conversations: [
      {
        id: CONVERSATION_ID,
        title: 'Interrupted',
        messages,
        createdAt: 1,
        updatedAt: 13,
        agentRuns: [
          {
            id: RUN_ID,
            userMessageId: 'user-1',
            goal: 'Read my notes and tell me when the review is.',
            status: 'running',
            createdAt: 10,
            updatedAt: 13,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 2,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 0,
            },
            controlGraph: createInitialAgentControlGraphSnapshot({ status: 'running' }),
          },
        ],
      } as never,
    ],
    activeConversationId: CONVERSATION_ID,
    isLoading: false,
  });
}

async function interruptTheRun() {
  const store = useChatStore.getState();
  const ensureAgentRunFinalResponse = createAgentRunFinalResponse({
    appendAgentRunCheckpoint: store.appendAgentRunCheckpoint,
    appendConversationLog: store.addConversationLog,
    pendingAgentRunFinalizations: new Map(),
    getResolveConversationFinalizationContext: () => undefined,
    setAgentRunPhase: store.setAgentRunPhase,
    updateAgentRunSummary: store.updateAgentRunSummary,
    updateMessage: store.updateMessage,
    updateMessageAssistantMetadata: store.updateMessageAssistantMetadata,
    updateMessageProviderReplay: store.updateMessageProviderReplay,
  });
  const signal = new AbortController().signal;
  const error = new TypeError('terminated');
  const finalizeTrackedRun = jest.fn(() => true);
  const setChatError = jest.fn();

  const outcome = resolveForegroundInterruptedResponseOutcome({
    conversationId: CONVERSATION_ID,
    error,
    runId: RUN_ID,
  });
  await handleForegroundInterruptedResponseRecovery({
    appendConversationLog: store.addConversationLog,
    assertNotAborted: () => undefined,
    conversationId: CONVERSATION_ID,
    currentAssistantMessageId: DRAFT_ID,
    errorMessage: error.message,
    finalizeTrackedRun,
    outcome,
    recoverAgentRunFinalPreview: (status, timestamp, preferredAssistantMessageId, recoverySignal) =>
      recoverForegroundAgentRunFinalPreview({
        conversationId: CONVERSATION_ID,
        ensureAgentRunFinalResponse,
        finalizationProviderContext: undefined as never,
        preferredAssistantMessageId,
        runId: RUN_ID,
        signal: recoverySignal,
        status,
        timestamp,
      }),
    requestPersistenceCheckpoint: jest.fn(),
    runId: RUN_ID,
    setAgentRunPhase: store.setAgentRunPhase,
    setChatError,
    signal,
    updateAgentRunSummary: store.updateAgentRunSummary,
    updateMessage: store.updateMessage,
    updateMessageAssistantMetadata: store.updateMessageAssistantMetadata,
    visibleContent: PARTIAL_TEXT,
  });

  const draft = useChatStore
    .getState()
    .conversations[0]!.messages.find((message) => message.id === DRAFT_ID);
  return { outcome, finalizeTrackedRun, setChatError, draft };
}

describe('a foreground run whose stream drops after its tools ran', () => {
  beforeEach(() => {
    seedRunInterruptedAfterToolWork();
  });

  it('fails the run instead of resuming it without its tools', async () => {
    const { outcome, finalizeTrackedRun } = await interruptTheRun();

    expect(outcome).toEqual({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'terminated',
    });
    expect(finalizeTrackedRun).toHaveBeenCalledWith(
      'failed',
      expect.any(String),
      'Turn failed',
      'terminated',
    );
  });
});
