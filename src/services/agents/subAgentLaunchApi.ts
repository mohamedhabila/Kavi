import type { LlmProviderConfig } from '../../types/provider';
import type { SubAgentConfig, SubAgentResult } from '../../types/subAgent';
import {
  assertProviderReadyForRequest,
  bindProviderToModel,
  hydrateProviderForRequest,
} from '../llm/support/providerSupport';
import type { PreparedSubAgentSession } from './subAgentLaunchScaffolding';

type RunningSubAgentLaunch = {
  sessionId: string;
  status: 'running';
  depth: number;
  resultPromise: Promise<SubAgentResult>;
};

export function createSubAgentLaunchApi<
  TAgent extends { sessionId: string; status: string },
>(params: {
  prepareSubAgentSession: (
    config: SubAgentConfig,
  ) => Promise<PreparedSubAgentSession<TAgent> | SubAgentResult>;
  schedulePreparedSubAgentRun: (
    prepared: PreparedSubAgentSession<TAgent>,
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ) => Promise<SubAgentResult>;
  runPreparedSubAgent: (
    prepared: PreparedSubAgentSession<TAgent>,
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ) => Promise<SubAgentResult>;
  trackSubAgentResultPromise: (
    sessionId: string,
    resultPromise: Promise<SubAgentResult>,
  ) => Promise<SubAgentResult>;
  persistPreparedSubAgentLaunchStateBestEffort: (
    prepared: PreparedSubAgentSession<TAgent>,
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ) => Promise<void>;
  observeBackgroundSubAgentResult: (
    started: { sessionId: string; resultPromise: Promise<SubAgentResult> },
    options?: { announce?: boolean },
  ) => void;
}) {
  async function startSubAgent(
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ): Promise<RunningSubAgentLaunch> {
    const hydratedProvider = bindProviderToModel(
      await hydrateProviderForRequest(provider),
      config.model,
    );
    assertProviderReadyForRequest(
      hydratedProvider,
      provider.name ? `Sub-agent provider "${provider.name}"` : 'Sub-agent provider',
    );

    const prepared = await params.prepareSubAgentSession(config);
    if ('status' in prepared) {
      throw new Error(prepared.error || prepared.output || 'sub-agent-launch-failed');
    }

    const resultPromise = params.trackSubAgentResultPromise(
      prepared.sessionId,
      params.schedulePreparedSubAgentRun(prepared, config, hydratedProvider, allProviders),
    );

    await params.persistPreparedSubAgentLaunchStateBestEffort(
      prepared,
      config,
      hydratedProvider,
      allProviders,
    );

    return {
      sessionId: prepared.sessionId,
      status: 'running',
      depth: prepared.depth + 1,
      resultPromise,
    };
  }

  async function spawnSubAgent(
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ): Promise<SubAgentResult> {
    const hydratedProvider = bindProviderToModel(
      await hydrateProviderForRequest(provider),
      config.model,
    );
    assertProviderReadyForRequest(
      hydratedProvider,
      provider.name ? `Sub-agent provider "${provider.name}"` : 'Sub-agent provider',
    );

    const prepared = await params.prepareSubAgentSession(config);
    if ('status' in prepared) {
      return prepared;
    }

    await params.persistPreparedSubAgentLaunchStateBestEffort(
      prepared,
      config,
      hydratedProvider,
      allProviders,
    );

    return params.runPreparedSubAgent(prepared, config, hydratedProvider, allProviders);
  }

  async function launchSubAgent(
    config: SubAgentConfig,
    provider: LlmProviderConfig,
    allProviders?: LlmProviderConfig[],
  ): Promise<{ sessionId: string; status: 'running'; depth: number }> {
    const started = await startSubAgent(config, provider, allProviders);
    params.observeBackgroundSubAgentResult(started, {
      announce: config.announce !== false,
    });

    return {
      sessionId: started.sessionId,
      status: 'running',
      depth: started.depth,
    };
  }

  return {
    startSubAgent,
    spawnSubAgent,
    launchSubAgent,
  };
}
