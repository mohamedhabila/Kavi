import type { SubAgentConfig, SubAgentResult, SubAgentSnapshot } from '../../types/subAgent';
import { evaluateMobileSpawnPreflight } from './mobileSpawnPolicy';
import type { ScheduledSubAgentLaunchControl } from './subAgentRuntimeSignals';

export interface PreparedSubAgentSession<TAgent extends { sessionId: string; status: string }> {
  sessionId: string;
  depth: number;
  maxIterations: number;
  timeoutMs?: number;
  sandboxPolicy: 'full' | 'safe-only' | 'inherit';
  subAgent: TAgent;
}

export async function prepareSubAgentSession<
  TAgent extends { sessionId: string; status: string; name?: string },
>(params: {
  config: SubAgentConfig;
  maxSpawnDepth: number;
  normalizePrompt: (prompt: string | undefined) => string | undefined;
  normalizeMaxIterations: (value?: number) => number;
  normalizeTimeoutMs: (value?: number) => number | undefined;
  createSessionId: () => string;
  buildSubAgent: (info: {
    sessionId: string;
    depth: number;
    timeoutMs?: number;
    sandboxPolicy: 'full' | 'safe-only' | 'inherit';
    startedAt: number;
    config: SubAgentConfig;
  }) => TAgent;
  activeSubAgents: Map<string, TAgent>;
  scheduleRegistryPersist: () => void;
  logger: { debug: (message: string) => void };
  announceStarted?: (agent: TAgent) => void;
}): Promise<PreparedSubAgentSession<TAgent> | SubAgentResult> {
  const depth = params.config.depth ?? 0;
  const normalizedPrompt = params.normalizePrompt(params.config.prompt);

  if (depth >= params.maxSpawnDepth) {
    return {
      sessionId: '',
      output: `Error: maximum sub-agent spawn depth (${params.maxSpawnDepth}) exceeded. Cannot spawn deeper.`,
      toolsUsed: [],
      iterations: 0,
      status: 'error',
      error: `Max spawn depth ${params.maxSpawnDepth} exceeded`,
      depth,
    };
  }

  const spawnPreflight = evaluateMobileSpawnPreflight({
    depth,
    parentConversationId: params.config.parentConversationId,
    agentRunId: params.config.agentRunId,
    liveWorkers: Array.from(params.activeSubAgents.values()) as unknown as SubAgentSnapshot[],
  });
  if (spawnPreflight.status === 'blocked') {
    return {
      sessionId: '',
      output: `Error: ${spawnPreflight.error}`,
      toolsUsed: [],
      iterations: 0,
      status: 'error',
      error: spawnPreflight.error,
      depth,
    };
  }

  if (!normalizedPrompt) {
    return {
      sessionId: '',
      output: 'Error: worker launch rejected because prompt is missing or empty.',
      toolsUsed: [],
      iterations: 0,
      status: 'error',
      error: 'Sub-agent prompt must be a non-empty string.',
      depth,
    };
  }

  const sessionId = params.createSessionId();
  const maxIterations = params.normalizeMaxIterations(params.config.maxIterations);
  const timeoutMs = params.normalizeTimeoutMs(params.config.timeoutMs);
  const sandboxPolicy = params.config.sandboxPolicy ?? 'inherit';
  const startedAt = Date.now();
  const subAgent = params.buildSubAgent({
    sessionId,
    depth,
    timeoutMs,
    sandboxPolicy,
    startedAt,
    config: params.config,
  });

  params.activeSubAgents.set(sessionId, subAgent);
  params.scheduleRegistryPersist();

  const agentLabel = subAgent.name ? `${subAgent.name} (${sessionId})` : sessionId;
  params.logger.debug(
    `Spawning ${agentLabel} at depth ${depth}, maxIter=${maxIterations}, timeout=${timeoutMs != null ? `${timeoutMs}ms` : 'none'}, sandbox=${sandboxPolicy}`,
  );

  if (params.config.announce !== false) {
    params.announceStarted?.(subAgent);
  }

  return {
    sessionId,
    depth,
    maxIterations,
    timeoutMs,
    sandboxPolicy,
    subAgent,
  };
}

export function trackSubAgentResultPromise(
  sessionId: string,
  resultPromise: Promise<SubAgentResult>,
  activeResultPromises: Map<string, Promise<SubAgentResult>>,
): Promise<SubAgentResult> {
  activeResultPromises.set(sessionId, resultPromise);
  void resultPromise.finally(() => {
    if (activeResultPromises.get(sessionId) === resultPromise) {
      activeResultPromises.delete(sessionId);
    }
  });
  return resultPromise;
}

export function schedulePreparedSubAgentRun<
  TAgent extends { sessionId: string; status: string },
>(params: {
  prepared: PreparedSubAgentSession<TAgent>;
  announceFailure: boolean;
  scheduledSubAgentLaunches: Map<string, ScheduledSubAgentLaunchControl>;
  scheduleQueuedLaunchWatch: (agent: TAgent, announceFailure: boolean) => void;
  buildResultFromSnapshot: (agent: TAgent) => SubAgentResult;
  runPreparedSubAgent: () => Promise<SubAgentResult>;
}): Promise<SubAgentResult> {
  params.scheduleQueuedLaunchWatch(params.prepared.subAgent, params.announceFailure);

  return new Promise<SubAgentResult>((resolve, reject) => {
    const launchHandle = setTimeout(() => {
      params.scheduledSubAgentLaunches.delete(params.prepared.sessionId);

      if (params.prepared.subAgent.status !== 'running') {
        resolve(params.buildResultFromSnapshot(params.prepared.subAgent));
        return;
      }

      void params.runPreparedSubAgent().then(resolve, reject);
    }, 0);
    (launchHandle as any)?.unref?.();

    params.scheduledSubAgentLaunches.set(params.prepared.sessionId, {
      handle: launchHandle,
      resolve,
      reject,
    });
  });
}
