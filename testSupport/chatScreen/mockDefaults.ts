import { cleanup } from '@testing-library/react-native';
import { __resetAgentRunCancellationRegistryForTests } from '../../src/services/agents/agentRunCancellation';
import {
  buildMockPilotEvaluation,
  createAgentRunControlGraphState,
  nextMockTimestamp,
} from './fixtures';
import {
  resetMockChatScreenState,
  updateMockAgentRun,
  updateMockConversation,
  upsertMockToolCall,
} from './state';
import { mockOpenDrawer } from './componentMocks';
import {
  mockAddConversationLog,
  mockAddMessage,
  mockAddToolCall,
  mockAppendAgentRunCheckpoint,
  mockCompleteAgentRun,
  mockCreateConversation,
  mockEditMessage,
  mockGetOrCreateCanonicalThread,
  mockRecordAgentRunEvidence,
  mockRecordConversationUsage,
  mockSetActiveProviderAndModel,
  mockSetAgentRunPhase,
  mockSetLastUsedModel,
  mockSetLoading,
  mockStartAgentRun,
  mockUpdateAgentRunAsyncWork,
  mockUpdateAgentRunControlGraph,
  mockUpdateAgentRunPlan,
  mockUpdateAgentRunSummary,
  mockUpdateMessage,
  mockUpdateMessageAssistantMetadata,
  mockUpdateMessageEffect,
  mockUpdateMessageEnrichedContent,
  mockUpdateMessageProviderReplay,
  mockUpdateMessageReasoning,
  mockUpdateModeInConversation,
  mockUpdateModelInConversation,
  mockUpdatePersonaInConversation,
  mockUpdateToolCallStatus,
} from './storeMocks';
import {
  mockBuildAgentRunCompletionFallbackOutput,
  mockBuildAgentRunToolResultFallback,
  mockBuildAgentRunVisibleDraftRecoveryText,
  mockBuildMissingFinalResponseFallback,
  mockCanRecoverAgentRunFinalResponse,
  mockCancelSubAgent,
  mockCollectAgentRunFinalizationEvidence,
  mockEvaluateAgentRunWithPilot,
  mockExportConversationAsMarkdown,
  mockFileWrite,
  mockGetProviderApiKey,
  mockHasCompletedExecutionRecoveryEvidence,
  mockHasVerifiedFinalizationEvidence,
  mockImportConversationWorkspaceAttachment,
  mockIsAvailableAsync,
  mockRunOrchestrator,
  mockShareAsync,
  mockShareConversationWorkspaceFile,
  mockShareTextExport,
  mockSynthesizeAgentRunFinalAnswer,
} from './serviceMocks';

export function cleanupChatScreenTestEnvironment() {
  cleanup();

  try {
    jest.useRealTimers();
  } catch {
    // Ignore when the environment is already using real timers.
  }
}

export function resetChatScreenTestEnvironment() {
  jest.clearAllMocks();
  const resettableMocks = {
    mockOpenDrawer,
    mockAddMessage,
    mockUpdateMessage,
    mockUpdateMessageEnrichedContent,
    mockCreateConversation,
    mockGetOrCreateCanonicalThread,
    mockSetLoading,
    mockEditMessage,
    mockUpdateModelInConversation,
    mockSetActiveProviderAndModel,
    mockSetLastUsedModel,
    mockUpdateMessageReasoning,
    mockUpdateMessageProviderReplay,
    mockUpdateMessageAssistantMetadata,
    mockAddToolCall,
    mockUpdateToolCallStatus,
    mockUpdateMessageEffect,
    mockUpdatePersonaInConversation,
    mockUpdateModeInConversation,
    mockRecordConversationUsage,
    mockAddConversationLog,
    mockStartAgentRun,
    mockSetAgentRunPhase,
    mockAppendAgentRunCheckpoint,
    mockUpdateAgentRunSummary,
    mockUpdateAgentRunAsyncWork,
    mockUpdateAgentRunControlGraph,
    mockUpdateAgentRunPlan,
    mockCompleteAgentRun,
    mockRecordAgentRunEvidence,
    mockGetProviderApiKey,
    mockCollectAgentRunFinalizationEvidence,
    mockBuildAgentRunToolResultFallback,
    mockBuildAgentRunCompletionFallbackOutput,
    mockBuildAgentRunVisibleDraftRecoveryText,
    mockBuildMissingFinalResponseFallback,
    mockCanRecoverAgentRunFinalResponse,
    mockHasCompletedExecutionRecoveryEvidence,
    mockHasVerifiedFinalizationEvidence,
    mockSynthesizeAgentRunFinalAnswer,
    mockEvaluateAgentRunWithPilot,
    mockCancelSubAgent,
    mockRunOrchestrator,
    mockExportConversationAsMarkdown,
    mockShareTextExport,
    mockShareConversationWorkspaceFile,
    mockImportConversationWorkspaceAttachment,
    mockShareAsync,
    mockIsAvailableAsync,
    mockFileWrite,
  };

  Object.entries(resettableMocks).forEach(([name, mockFn]) => {
    if (!mockFn) {
      throw new Error(`${name} is not initialized`);
    }

    mockFn.mockReset();
  });

  __resetAgentRunCancellationRegistryForTests();
  resetMockChatScreenState();
  mockCreateConversation.mockReturnValue('new-conv');
  mockGetOrCreateCanonicalThread.mockReturnValue('new-conv');
  mockGetProviderApiKey.mockResolvedValue('sk-test');
  mockRunOrchestrator.mockResolvedValue(undefined);
  mockExportConversationAsMarkdown.mockReturnValue('# Exported');
  mockShareTextExport.mockResolvedValue({
    fileName: 'Test_Chat.md',
    fileUri: 'file:///cache/test.md',
  });
  mockShareConversationWorkspaceFile.mockResolvedValue({
    fileName: 'workspace.txt',
    fileUri: 'file:///docs/workspace.txt',
  });
  mockShareAsync.mockResolvedValue(undefined);
  mockIsAvailableAsync.mockResolvedValue(true);
  mockImportConversationWorkspaceAttachment.mockImplementation(
    async (_conversationId: string, attachment: any) => ({
      imported: true,
      attachment,
    }),
  );
  mockStartAgentRun.mockReturnValue('run-1');
  mockAddMessage.mockImplementation((conversationId: string, message: any) => {
    updateMockConversation(conversationId, (conversation) => {
      const timestamp = message.timestamp ?? nextMockTimestamp();
      return {
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            ...message,
            id: message.id ?? `msg-${timestamp}`,
            timestamp,
          },
        ],
        updatedAt: timestamp,
      };
    });
  });
  mockUpdateMessage.mockImplementation(
    (conversationId: string, messageId: string, content: string) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === messageId ? { ...message, content } : message,
        ),
      }));
    },
  );
  mockUpdateMessageReasoning.mockImplementation(
    (conversationId: string, messageId: string, reasoning: string) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === messageId ? { ...message, reasoning } : message,
        ),
      }));
    },
  );
  mockUpdateMessageProviderReplay.mockImplementation(
    (conversationId: string, messageId: string, providerReplay: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === messageId ? { ...message, providerReplay } : message,
        ),
      }));
    },
  );
  mockUpdateMessageAssistantMetadata.mockImplementation(
    (conversationId: string, messageId: string, assistantMetadata: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === messageId ? { ...message, assistantMetadata } : message,
        ),
      }));
    },
  );
  mockUpdateMessageEffect.mockImplementation(
    (conversationId: string, messageId: string, effectId: string) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) =>
          message.id === messageId ? { ...message, effectId } : message,
        ),
      }));
    },
  );
  mockAddToolCall.mockImplementation((conversationId: string, messageId: string, toolCall: any) => {
    updateMockConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message: any) => {
        if (message.id !== messageId) {
          return message;
        }

        return {
          ...message,
          toolCalls: upsertMockToolCall(message.toolCalls, toolCall),
        };
      }),
    }));
  });
  mockUpdateToolCallStatus.mockImplementation(
    (
      conversationId: string,
      messageId: string,
      toolCallId: string,
      status: string,
      payload?: { result?: string; error?: string; completedAt?: number; progressText?: string },
    ) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message: any) => {
          if (message.id !== messageId) {
            return message;
          }

          return {
            ...message,
            toolCalls: (message.toolCalls ?? []).map((toolCall: any) =>
              toolCall.id === toolCallId
                ? {
                    ...toolCall,
                    status,
                    result: payload?.result ?? toolCall.result,
                    error: payload?.error ?? toolCall.error,
                    completedAt: payload?.completedAt ?? toolCall.completedAt,
                    progressText: payload?.progressText ?? toolCall.progressText,
                  }
                : toolCall,
            ),
          };
        }),
      }));
    },
  );
  mockCollectAgentRunFinalizationEvidence.mockImplementation(
    (_messages: any[], _userMessageId: string, iterations: number) => ({
      originalPrompt: 'Test task',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: '',
      lastSubstantiveResult: '',
      resultPreviews: [{ sourceName: 'sessions_spawn', preview: 'Worker launched successfully.' }],
      toolsUsed: ['sessions_spawn'],
      iterations,
    }),
  );
  mockHasVerifiedFinalizationEvidence.mockImplementation(
    (evidence: any) =>
      !!evidence?.lastSubstantiveResult ||
      (evidence?.resultPreviews?.length ?? 0) > 0 ||
      (evidence?.toolsUsed?.length ?? 0) > 0,
  );
  mockBuildAgentRunToolResultFallback.mockImplementation(
    ({ status }: { status: string }) => `Fallback final response (${status})`,
  );
  mockBuildAgentRunCompletionFallbackOutput.mockImplementation((params: any) =>
    mockBuildAgentRunToolResultFallback(params),
  );
  mockBuildAgentRunVisibleDraftRecoveryText.mockImplementation(
    ({ visibleDraft, status, evidence }: any) => {
      const fallback = mockBuildAgentRunToolResultFallback({ status, evidence });
      if (
        visibleDraft.includes('Note: the response stream failed before the answer could finish.')
      ) {
        return visibleDraft;
      }
      return fallback
        ? `${visibleDraft}\n\nNote: the response stream failed before the answer could finish.\n${fallback}`
        : `${visibleDraft}\n\nNote: the response stream failed before the answer could finish.`;
    },
  );
  mockBuildMissingFinalResponseFallback.mockImplementation(
    (status: string) => `Missing final response (${status})`,
  );
  mockCanRecoverAgentRunFinalResponse.mockImplementation(
    ({ evidence, hasProviderContext }: any) =>
      !!evidence?.lastSubstantiveResult ||
      (evidence?.resultPreviews?.length ?? 0) > 0 ||
      (evidence?.toolsUsed?.length ?? 0) > 0 ||
      (hasProviderContext && !!evidence?.lastNonEmptyAssistantContent?.trim?.()),
  );
  mockHasCompletedExecutionRecoveryEvidence.mockImplementation(
    ({ evidence, pendingAsyncOperationCount, liveSubAgentSnapshots }: any) =>
      !evidence?.hasIncompleteToolCalls &&
      (pendingAsyncOperationCount ?? 0) === 0 &&
      !(liveSubAgentSnapshots ?? []).some((snapshot: any) => snapshot.status === 'running') &&
      (!!evidence?.lastSubstantiveResult || (evidence?.resultPreviews?.length ?? 0) > 0),
  );
  mockSetAgentRunPhase.mockImplementation(
    (conversationId: string, phase: string, params?: any, runId?: string) => {
      updateMockAgentRun(conversationId, runId, (run: any) => ({
        ...run,
        currentPhase: phase,
        updatedAt: params?.timestamp ?? run.updatedAt,
        latestSummary: params?.detail ?? run.latestSummary,
        checkpoints: params?.checkpointTitle
          ? [
              ...(run.checkpoints ?? []),
              {
                id: `checkpoint-${phase}-${params?.timestamp ?? nextMockTimestamp()}`,
                timestamp: params?.timestamp ?? nextMockTimestamp(),
                kind: params?.checkpointKind ?? 'phase',
                title: params.checkpointTitle,
                detail: params?.checkpointDetail ?? params?.detail,
              },
            ]
          : run.checkpoints,
      }));
    },
  );
  mockUpdateAgentRunSummary.mockImplementation(
    (conversationId: string, patch: any, runId?: string) => {
      updateMockAgentRun(conversationId, runId, (run: any) => ({
        ...run,
        updatedAt: patch?.timestamp ?? run.updatedAt,
        latestSummary: patch?.latestSummary ?? run.latestSummary,
        summary: {
          ...run.summary,
          ...patch,
        },
      }));
    },
  );
  mockUpdateAgentRunAsyncWork.mockImplementation(
    (conversationId: string, params?: any, runId?: string) => {
      updateMockAgentRun(conversationId, runId, (run: any) => {
        const timestamp = params?.timestamp ?? run.updatedAt;
        const existingControlGraph = run.controlGraph ?? createAgentRunControlGraphState();
        const existingAsyncWork = existingControlGraph.asyncWork ?? {};
        const pendingOperations =
          params?.pendingOperations !== undefined
            ? params.pendingOperations
            : (existingAsyncWork.pendingOperations ?? []);
        const nextAsyncWork = {
          awaitingBackgroundWorkers:
            params?.awaitingBackgroundWorkers !== undefined
              ? params.awaitingBackgroundWorkers
              : existingAsyncWork.awaitingBackgroundWorkers === true,
          pendingOperations,
          updatedAt: timestamp,
        };

        return {
          ...run,
          updatedAt: timestamp,
          latestSummary: params?.latestSummary ?? run.latestSummary,
          controlGraph: {
            ...existingControlGraph,
            pendingAsyncCount: pendingOperations.length,
            asyncWork: nextAsyncWork,
            updatedAt: timestamp,
          },
          checkpoints: params?.checkpointTitle
            ? [
                ...(run.checkpoints ?? []),
                {
                  id: `checkpoint-async-${params?.timestamp ?? nextMockTimestamp()}`,
                  timestamp,
                  kind: params?.checkpointKind ?? 'run',
                  title: params.checkpointTitle,
                  detail: params?.checkpointDetail ?? params?.latestSummary,
                },
              ]
            : run.checkpoints,
        };
      });
    },
  );
  mockUpdateAgentRunControlGraph.mockImplementation(
    (conversationId: string, controlGraph: any, runId?: string) => {
      updateMockAgentRun(conversationId, runId, (run: any) => ({
        ...run,
        updatedAt: controlGraph?.updatedAt ?? run.updatedAt,
        controlGraph,
      }));
    },
  );
  mockUpdateAgentRunPlan.mockImplementation(
    (conversationId: string, patch: any, runId?: string) => {
      updateMockAgentRun(conversationId, runId, (run: any) => ({
        ...run,
        updatedAt: patch?.timestamp ?? run.updatedAt,
        plan: {
          ...(run.plan ?? {}),
          ...patch,
        },
      }));
    },
  );
  mockRecordAgentRunEvidence.mockImplementation(
    (conversationId: string, entries: any, params?: any, runId?: string) => {
      const draftEntries = Array.isArray(entries) ? entries : [entries];
      let recordedEntries: any[] | undefined;

      updateMockAgentRun(conversationId, runId, (run: any) => {
        const nextEvidence = [...(run.evidence ?? []), ...draftEntries].map(
          (entry: any, index: number) => ({
            ...entry,
            id: entry?.id ?? `evidence-${index}-${params?.timestamp ?? nextMockTimestamp()}`,
          }),
        );
        recordedEntries = nextEvidence;

        return {
          ...run,
          updatedAt: params?.timestamp ?? run.updatedAt,
          evidence: nextEvidence,
        };
      });

      return recordedEntries;
    },
  );
  mockCompleteAgentRun.mockImplementation(
    (conversationId: string, params?: any, runId?: string) => {
      updateMockConversation(conversationId, (conversation) => {
        const targetRunId = runId || conversation.activeAgentRunId;
        if (!targetRunId) {
          return conversation;
        }

        return {
          ...conversation,
          activeAgentRunId:
            conversation.activeAgentRunId === targetRunId
              ? undefined
              : conversation.activeAgentRunId,
          agentRuns: (conversation.agentRuns ?? []).map((run: any) =>
            run.id !== targetRunId
              ? run
              : {
                  ...run,
                  status: params?.status ?? 'completed',
                  controlGraph: createAgentRunControlGraphState({
                    ...(run.controlGraph ?? {}),
                    asyncWork: {
                      awaitingBackgroundWorkers: false,
                      pendingOperations: [],
                      updatedAt: params?.timestamp ?? run.updatedAt,
                    },
                    pendingAsyncCount: 0,
                    updatedAt: params?.timestamp ?? run.updatedAt,
                  }),
                  updatedAt: params?.timestamp ?? run.updatedAt,
                  latestSummary: params?.latestSummary ?? run.latestSummary,
                  checkpoints: params?.checkpointTitle
                    ? [
                        ...(run.checkpoints ?? []),
                        {
                          id: `checkpoint-complete-${params?.timestamp ?? nextMockTimestamp()}`,
                          timestamp: params?.timestamp ?? nextMockTimestamp(),
                          kind: params?.checkpointKind ?? 'run',
                          title: params.checkpointTitle,
                          detail: params?.checkpointDetail ?? params?.latestSummary,
                        },
                      ]
                    : run.checkpoints,
                },
          ),
        };
      });
    },
  );
  mockSynthesizeAgentRunFinalAnswer.mockResolvedValue({
    output: 'Synthesized final response',
    providerReplay: {
      openaiResponseOutput: [
        { id: 'final-output', type: 'message', role: 'assistant', content: [] },
      ],
    },
  });
  mockEvaluateAgentRunWithPilot.mockImplementation(async (params: any) => ({
    action: 'finalize',
    outcome: params.candidateOutcome ?? {
      status: 'completed',
      summary: 'Pilot approved finalization.',
    },
    checkpointTitle:
      params.candidateOutcome?.status === 'completed'
        ? 'Pilot approved finalization'
        : 'Pilot finalized with remaining gaps',
    checkpointDetail:
      params.candidateOutcome?.status === 'completed'
        ? 'Pilot score 17/20. Approved.'
        : 'Pilot score 8/20. Finalized with remaining gaps.',
    evaluation:
      params.candidateOutcome?.status === 'completed'
        ? buildMockPilotEvaluation()
        : buildMockPilotEvaluation({
            completionScore: 1,
            adherenceScore: 2,
            evidenceScore: 1,
            processScore: 2,
            overallScore: 6,
            approved: false,
            recommendedAction: 'blocked',
            confidence: 'medium',
            summary: 'Pilot did not approve finalization.',
            rationale: 'The run ended unsuccessfully.',
            strengths: [],
            gaps: ['The run ended unsuccessfully.'],
            criterionEvaluations: [
              {
                criterion: 'Produce the requested deliverable.',
                score: 1,
                maxScore: 5,
                status: 'blocked',
                rationale: 'No usable deliverable was produced.',
              },
              {
                criterion: 'Verify the result before finalizing.',
                score: 1,
                maxScore: 5,
                status: 'blocked',
                rationale: 'The run ended before verification.',
              },
            ],
          }),
  }));
}
