// ---------------------------------------------------------------------------
// Kavi — Orchestrator Engine (thin shell)
// ---------------------------------------------------------------------------
// Delegates bootstrap and graph-session execution to orchestrator/* modules.

import { createLogger } from '../utils/logger';
import {
  prepareOrchestratorSessionBootstrap,
  tryHandleOrchestratorSlashCommand,
} from './orchestrator/bootstrap';
import {
  MAX_IDENTICAL_TOOL_CALLS,
  MAX_TOOL_ITERATIONS,
  MAX_TOOL_ITERATIONS_SUPERAGENT,
} from './orchestrator/constants';
import { runOrchestratorGraphSession } from './orchestrator/session';
import type {
  OrchestratorCallbacks,
  OrchestratorOptions,
  OrchestratorRunResult,
} from './orchestrator/types';

export { MAX_IDENTICAL_TOOL_CALLS, MAX_TOOL_ITERATIONS, MAX_TOOL_ITERATIONS_SUPERAGENT };
export type { OrchestratorCallbacks, OrchestratorOptions, OrchestratorRunResult };

const logger = createLogger('Orchestrator');

export async function runOrchestrator(
  options: OrchestratorOptions,
  callbacks: OrchestratorCallbacks,
): Promise<OrchestratorRunResult> {
  const {
    conversationId,
    messages,
    provider,
    model,
    systemPrompt,
    personaId,
    allProviders,
    enableFailover = true,
    internalUserMessageCount = 0,
  } = options;

  if (
    await tryHandleOrchestratorSlashCommand({
      callbacks,
      conversationId,
      internalUserMessageCount,
      messages,
      agentRunId: options.agentRunId,
      signal: options.signal,
    })
  ) {
    return { terminalDisposition: 'command' };
  }

  const sessionBootstrap = await prepareOrchestratorSessionBootstrap({
    allProviders,
    callbacks,
    conversationId,
    enableFailover,
    initialPendingAsyncOperations: options.initialPendingAsyncOperations,
    internalUserMessageCount,
    logger,
    messages,
    model,
    personaId,
    provider,
    systemPrompt,
    toolFilter: options.toolFilter,
  });

  return runOrchestratorGraphSession({
    options,
    callbacks,
    sessionBootstrap,
  });
}
