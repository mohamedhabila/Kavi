// ---------------------------------------------------------------------------
// Kavi — E2E agent scenario runner (live LLM + graph orchestrator)
// ---------------------------------------------------------------------------

import { prepareE2EOrchestratorTurnResume } from '../../engine/graph/runResumePreparation';
import { runOrchestrator } from '../../engine/orchestrator';
import { resetE2ENativeMobileFixtures } from '../../engine/tools/e2eNativeCalendarFixtures';
import { SUPER_AGENT_PERSONA_ID } from '../../services/agents/personas';
import type { Message } from '../../types/message';
import { buildE2EProvider, isE2EAgentEvalEnabled } from './providerConfig';
import { finalizeE2EScenarioTurnMemory } from './e2eMemoryFinalize';
import { resetE2EMemorySandbox } from './sandboxMemory';
import { resetE2EWorkspaceSandbox, seedE2EWorkspaceSandbox } from './sandboxWorkspace';
import { resolveE2EScenarioTimeoutMs } from './scenarioTimeout';
import { buildScenarioCallbacks, createScenarioTrace, mergeScenarioTrace } from './scenarioTrace';
import { aggregateE2ETokenUsage } from './tokenUsage';
import { E2E_DEFAULT_MAX_TOKENS } from './thresholds';
import type { E2EScenario, E2EScenarioResult, E2EScenarioTurnTrace, E2EUserTurn } from './types';
import type { AgentRunControlGraphState } from '../../types/agentRun';

const DEFAULT_E2E_SYSTEM_PROMPT =
  'You are Kavi, a graph-controlled personal assistant. Use tools to complete tasks. ' +
  'Follow active graph goals and their required capabilities.';

function resolveScenarioUserTurns(scenario: E2EScenario): ReadonlyArray<E2EUserTurn> {
  if (scenario.userTurns && scenario.userTurns.length > 0) {
    return scenario.userTurns;
  }
  return [{ content: scenario.prompt }];
}

function buildUserMessage(content: string, sequence: number): Message {
  return {
    id: `e2e-user-${sequence}`,
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

function getLatestGraphSnapshot(
  snapshots: ReadonlyArray<AgentRunControlGraphState>,
): AgentRunControlGraphState | undefined {
  return snapshots[snapshots.length - 1];
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeConversationIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function resolveScenarioConversationId(baseConversationId: string): string {
  if (!isE2EAgentEvalEnabled()) {
    return baseConversationId;
  }

  const explicitRunId = sanitizeConversationIdPart(process.env.E2E_SCENARIO_RUN_ID?.trim() ?? '');
  const generatedRunId = sanitizeConversationIdPart(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  return `${baseConversationId}-${explicitRunId || generatedRunId}`;
}

export async function runE2EScenario(scenario: E2EScenario): Promise<E2EScenarioResult> {
  const startedAt = Date.now();
  const conversationId = resolveScenarioConversationId(scenario.conversationId);
  resetE2EWorkspaceSandbox();
  resetE2EMemorySandbox();
  resetE2ENativeMobileFixtures();
  seedE2EWorkspaceSandbox(conversationId, scenario.initialWorkspaceFiles ?? []);

  const provider = buildE2EProvider();
  const userTurns = resolveScenarioUserTurns(scenario);
  const messages: Message[] = scenario.initialMessages ? [...scenario.initialMessages] : [];
  const aggregateTrace = createScenarioTrace();
  const turnTraces: E2EScenarioTurnTrace[] = [];

  let previousGraphState: AgentRunControlGraphState | undefined;
  let messageSequence = 0;
  const scenarioAbortController = new AbortController();
  const scenarioTimeoutMs = resolveE2EScenarioTimeoutMs(scenario);
  const scenarioTimeout = setTimeout(() => {
    scenarioAbortController.abort();
  }, scenarioTimeoutMs);

  const nextMessageId = (prefix: string): string => {
    messageSequence += 1;
    return `e2e-${prefix}-${messageSequence}`;
  };

  try {
    for (let turnIndex = 0; turnIndex < userTurns.length; turnIndex += 1) {
      if (scenarioAbortController.signal.aborted) {
        aggregateTrace.errors.push(`scenario timed out after ${scenarioTimeoutMs}ms`);
        break;
      }

      const userTurn = userTurns[turnIndex];
      const userMessage = buildUserMessage(userTurn.content, messageSequence + 1);
      messageSequence += 1;
      messages.push(userMessage);

      const turnTrace = createScenarioTrace();

      const resumePreparation = prepareE2EOrchestratorTurnResume({
        graphState: previousGraphState,
        userMessageId: userMessage.id,
        messages,
      });

      const streamingAssistantContent = { value: '' };

      try {
        await runOrchestrator(
          {
            provider,
            model: provider.model,
            conversationId,
            workspaceConversationId: conversationId,
            personaId: SUPER_AGENT_PERSONA_ID,
            systemPrompt: scenario.systemPrompt ?? DEFAULT_E2E_SYSTEM_PROMPT,
            messages,
            maxTokens: scenario.maxTokens ?? E2E_DEFAULT_MAX_TOKENS,
            thinkingLevel: 'minimal',
            enableCompaction: false,
            enableFailover: false,
            initialAgentControlGraphState: resumePreparation.initialAgentControlGraphState,
            workflowScopeUserMessageId: resumePreparation.workflowScopeUserMessageId,
            signal: scenarioAbortController,
          },
          buildScenarioCallbacks(turnTrace, {
            appendConversationMessage: (message) => {
              messages.push(message);
            },
            nextMessageId,
            streamingAssistantContent,
          }),
        );
      } catch (error) {
        turnTrace.errors.push(resolveErrorMessage(error));
      }

      if (scenarioAbortController.signal.aborted) {
        turnTrace.errors.push(`scenario timed out after ${scenarioTimeoutMs}ms`);
      }

      mergeScenarioTrace(aggregateTrace, turnTrace);
      turnTraces.push({
        turnIndex,
        toolCalls: [...turnTrace.toolCalls],
        toolResults: [...turnTrace.toolResults],
        graphSnapshots: [...turnTrace.graphSnapshots],
        usage: aggregateE2ETokenUsage(turnTrace.usageEvents),
        completed: turnTrace.completed,
      });
      previousGraphState = getLatestGraphSnapshot(turnTrace.graphSnapshots);

      if (turnTrace.completed) {
        try {
          await finalizeE2EScenarioTurnMemory({
            conversationId,
            threadTitle: scenario.threadTitle ?? scenario.id,
            messages,
            activeChatProvider: provider,
            graphState: previousGraphState,
          });
        } catch {
          // Memory finalize is best-effort; rubrics surface ingestion gaps.
        }
      }

      if (!turnTrace.completed || scenarioAbortController.signal.aborted) {
        break;
      }
    }
  } finally {
    clearTimeout(scenarioTimeout);
  }

  return {
    fixtureId: scenario.id,
    conversationId,
    toolCalls: aggregateTrace.toolCalls,
    toolResults: aggregateTrace.toolResults,
    graphSnapshots: aggregateTrace.graphSnapshots,
    turnTraces,
    usage: aggregateE2ETokenUsage(aggregateTrace.usageEvents),
    errors: aggregateTrace.errors,
    completed: aggregateTrace.completed,
    durationMs: Date.now() - startedAt,
    userTurnCount: userTurns.length,
  };
}
