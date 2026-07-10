// ---------------------------------------------------------------------------
// Kavi — E2E agent scenario runner (live product foreground path)
// ---------------------------------------------------------------------------

import { resetE2ENativeMobileFixtures } from './e2eNativeMobileFixtures';
import { installE2EScenarioEnvironment } from './e2eScenarioEnvironment';
import { runForegroundScenario } from './foregroundScenarioDriver';
import { buildE2EProvider, isE2EAgentEvalEnabled } from './providerConfig';
import { resetE2EMemorySandbox } from './sandboxMemory';
import { resetE2EWorkspaceSandbox, seedE2EWorkspaceSandbox } from './sandboxWorkspace';
import { mapForegroundScenarioResult } from './scenarioResultMapper';
import { resolveE2EScenarioTimeoutMs } from './scenarioTimeout';
import { E2E_DEFAULT_MAX_TOKENS } from './thresholds';
import type { E2EScenario, E2EScenarioContentClass, E2EScenarioResult, E2EUserTurn } from './types';

const DEFAULT_E2E_SYSTEM_PROMPT =
  'You are Kavi, a graph-controlled personal assistant. Use tools to complete tasks. ' +
  'Follow active graph goals and their required capabilities.';

function resolveScenarioUserTurns(scenario: E2EScenario): ReadonlyArray<E2EUserTurn> {
  if (scenario.userTurns && scenario.userTurns.length > 0) {
    return scenario.userTurns;
  }
  return [{ content: scenario.prompt }];
}

function sanitizeConversationIdPart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
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

function requireScenarioContentClass(value: unknown): E2EScenarioContentClass {
  if (value === 'private' || value === 'synthetic_public') return value;
  throw new Error('Scenario contentClass must be private or synthetic_public.');
}

export async function runE2EScenario(scenario: E2EScenario): Promise<E2EScenarioResult> {
  const startedAt = Date.now();
  const contentClass = requireScenarioContentClass(scenario.contentClass);
  const conversationId = resolveScenarioConversationId(scenario.conversationId);
  resetE2EWorkspaceSandbox();
  resetE2EMemorySandbox();
  resetE2ENativeMobileFixtures();
  seedE2EWorkspaceSandbox(conversationId, scenario.initialWorkspaceFiles ?? []);

  const provider = buildE2EProvider();
  const userTurns = resolveScenarioUserTurns(scenario);
  const scenarioTimeoutMs = resolveE2EScenarioTimeoutMs(scenario);
  const perTurnTimeoutMs = Math.max(1, Math.floor(scenarioTimeoutMs / userTurns.length));
  const uninstallScenarioEnvironment = installE2EScenarioEnvironment();

  try {
    const driverResult = await runForegroundScenario({
      provider,
      conversationId,
      conversationTitle: scenario.threadTitle ?? scenario.id,
      systemPrompt: scenario.systemPrompt ?? DEFAULT_E2E_SYSTEM_PROMPT,
      initialMessages: scenario.initialMessages,
      defaultMode: scenario.execution.initialMode,
      turns: userTurns.map((turn) => ({
        content: turn.content,
        route: turn.route ?? scenario.execution.route,
        timeoutMs: perTurnTimeoutMs,
      })),
      maxTokens: scenario.maxTokens ?? E2E_DEFAULT_MAX_TOKENS,
      memoryTimeoutMs: perTurnTimeoutMs,
    });
    return mapForegroundScenarioResult({
      contentClass,
      driverResult,
      durationMs: Date.now() - startedAt,
      fixtureId: scenario.id,
      requestedUserTurnCount: userTurns.length,
    });
  } finally {
    uninstallScenarioEnvironment();
  }
}
