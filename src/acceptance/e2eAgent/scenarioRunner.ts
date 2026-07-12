// ---------------------------------------------------------------------------
// Kavi — E2E agent scenario runner (live product foreground path)
// ---------------------------------------------------------------------------

import { writeE2EPrivateScenarioEvidence } from './e2ePrivateScenarioEvidence';
import { installE2EScenarioEnvironment } from './e2eScenarioEnvironment';
import { runForegroundScenario } from './foregroundScenarioDriver';
import type { ForegroundScenarioRouteDirective } from './foregroundScenarioDriverTypes';
import { resetAndVerifyE2EScenarioSandboxes } from './e2ePairedStateIsolation';
import { buildE2EProvider, isE2EAgentEvalEnabled } from './providerConfig';
import { seedE2EWorkspaceSandbox } from './sandboxWorkspace';
import { mapForegroundScenarioResult } from './scenarioResultMapper';
import { resolveE2EScenarioTimeoutMs } from './scenarioTimeout';
import { E2E_DEFAULT_MAX_TOKENS, E2E_PER_USER_TURN_TIMEOUT_MS } from './thresholds';
import type { E2EScenario, E2EScenarioContentClass, E2EScenarioResult, E2EUserTurn } from './types';
import type { LlmProviderConfig } from '../../types/provider';
import type {
  MemoryContextStrategy,
  MemoryRetrievalStrategy,
} from '../../services/memory/memoryAccessPolicy';

const DEFAULT_E2E_SYSTEM_PROMPT =
  'You are Kavi, a graph-controlled personal assistant. Use tools to complete tasks. ' +
  'Follow active graph goals and their required capabilities.';

export type E2EScenarioRunOptions = Readonly<{
  provider?: LlmProviderConfig;
  maxTokens?: number;
  scenarioTimeoutMs?: number;
  perTurnTimeoutMs?: number;
  memoryTimeoutMs?: number;
  routeOverride?: ForegroundScenarioRouteDirective;
  disableLongTermMemory?: boolean;
  allowedToolNames?: ReadonlyArray<string>;
  beforeTurns?: (identity: {
    conversationId: string;
    workspaceConversationId: string;
  }) => Promise<void> | void;
  memoryRetrievalStrategy?: MemoryRetrievalStrategy;
  memoryContextStrategy?: MemoryContextStrategy;
  enableCompaction?: boolean;
  /** Public-safe, evaluator-owned namespace that isolates paired condition sessions and cache keys. */
  conversationIdSuffix?: string;
}>;

export function resolveE2EScenarioSystemPrompt(scenario: E2EScenario): string {
  return scenario.systemPrompt ?? DEFAULT_E2E_SYSTEM_PROMPT;
}

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

function resolveScenarioConversationId(
  baseConversationId: string,
  conversationIdSuffix?: string,
): string {
  let conversationId = baseConversationId;
  if (isE2EAgentEvalEnabled()) {
    const explicitRunId = sanitizeConversationIdPart(process.env.E2E_SCENARIO_RUN_ID?.trim() ?? '');
    const generatedRunId = sanitizeConversationIdPart(
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    );
    conversationId = `${conversationId}-${explicitRunId || generatedRunId}`;
  }
  if (conversationIdSuffix !== undefined) {
    const canonicalSuffix = sanitizeConversationIdPart(conversationIdSuffix);
    if (!canonicalSuffix || canonicalSuffix !== conversationIdSuffix) {
      throw new Error('conversationIdSuffix must be a non-empty canonical identifier.');
    }
    conversationId = `${conversationId}-${canonicalSuffix}`;
  }
  return conversationId;
}

function requireScenarioContentClass(value: unknown): E2EScenarioContentClass {
  if (value === 'private' || value === 'synthetic_public') return value;
  throw new Error('Scenario contentClass must be private or synthetic_public.');
}

export async function runE2EScenario(
  scenario: E2EScenario,
  options: E2EScenarioRunOptions = {},
): Promise<E2EScenarioResult> {
  const startedAt = Date.now();
  const contentClass = requireScenarioContentClass(scenario.contentClass);
  const conversationId = resolveScenarioConversationId(
    scenario.conversationId,
    options.conversationIdSuffix,
  );
  resetAndVerifyE2EScenarioSandboxes();
  seedE2EWorkspaceSandbox(conversationId, scenario.initialWorkspaceFiles ?? []);

  const provider = options.provider ?? buildE2EProvider();
  const userTurns = resolveScenarioUserTurns(scenario);
  const scenarioTimeoutMs = options.scenarioTimeoutMs ?? resolveE2EScenarioTimeoutMs(scenario);
  const perTurnTimeoutMs =
    options.perTurnTimeoutMs ??
    Math.min(
      E2E_PER_USER_TURN_TIMEOUT_MS,
      Math.max(1, Math.floor(scenarioTimeoutMs / userTurns.length)),
    );
  const uninstallScenarioEnvironment = installE2EScenarioEnvironment();

  try {
    const driverResult = await runForegroundScenario({
      provider,
      conversationId,
      conversationTitle: scenario.threadTitle ?? scenario.id,
      systemPrompt: resolveE2EScenarioSystemPrompt(scenario),
      initialMessages: scenario.initialMessages,
      defaultMode: scenario.execution.initialMode,
      scenarioTimeoutMs,
      turns: userTurns.map((turn) => ({
        content: turn.content,
        lifecycleBefore: turn.lifecycleBefore,
        route: options.routeOverride ?? turn.route ?? scenario.execution.route,
        selectedMode: turn.selectedMode,
        timeoutMs: perTurnTimeoutMs,
      })),
      maxTokens: options.maxTokens ?? scenario.maxTokens ?? E2E_DEFAULT_MAX_TOKENS,
      ...(options.memoryTimeoutMs !== undefined
        ? { memoryTimeoutMs: options.memoryTimeoutMs }
        : {}),
      disableLongTermMemory: options.disableLongTermMemory,
      allowedToolNames: options.allowedToolNames,
      beforeTurns: options.beforeTurns,
      memoryRetrievalStrategy: options.memoryRetrievalStrategy,
      memoryContextStrategy: options.memoryContextStrategy,
      enableCompaction: options.enableCompaction,
    });
    const result = mapForegroundScenarioResult({
      contentClass,
      driverResult,
      durationMs: Date.now() - startedAt,
      fixtureId: scenario.id,
      requestedUserTurnCount: userTurns.length,
    });
    writeE2EPrivateScenarioEvidence({ scenario, result });
    return result;
  } finally {
    uninstallScenarioEnvironment();
  }
}
