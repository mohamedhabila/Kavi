import type { LlmProviderConfig } from '../../../types/provider';
import type { Message } from '../../../types/message';
import type {
  SubAgentCompletionState,
  SubAgentConfig,
  SubAgentResult,
  SubAgentSnapshot,
} from '../../../types/subAgent';
import { cloneAttachments } from '../../../utils/messageAttachments';
import type { PersistRegistryBestEffortOutcome, SessionContextStoreParams } from './sessionContext';
import type { TerminalAnnouncement } from './phases';

function truncateSubAgentOutput(output: string, outputTruncation: number): string {
  return output.length > outputTruncation
    ? output.slice(0, outputTruncation) + '\n\n[Output truncated]'
    : output;
}

function buildTerminalResult(
  sessionId: string,
  output: string,
  completionState: SubAgentCompletionState | undefined,
  toolsUsed: string[],
  iterations: number,
  status: SubAgentResult['status'],
  depth: number,
  artifacts?: SubAgentSnapshot['artifacts'],
  error?: string,
): SubAgentResult {
  return {
    sessionId,
    output,
    ...(completionState ? { completionState } : {}),
    toolsUsed,
    iterations,
    status,
    ...(error ? { error } : {}),
    depth: depth + 1,
    ...(artifacts?.length ? { artifacts: cloneAttachments(artifacts) } : {}),
  };
}

async function persistTerminalSessionContext(params: {
  sessionId: string;
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  conversationSummary: string;
  messages: Message[];
  persistContext: string;
  scheduleSessionContextCheckpoint: (
    context: SessionContextStoreParams,
    options: { immediate: boolean },
  ) => void;
  persistRegistryBestEffort: (context: string) => Promise<PersistRegistryBestEffortOutcome>;
  scheduleSessionContextEvictionWhenDurable: (
    sessionId: string,
    persistOutcome: PersistRegistryBestEffortOutcome,
  ) => void;
}): Promise<void> {
  params.scheduleSessionContextCheckpoint(
    {
      sessionId: params.sessionId,
      config: params.config,
      provider: params.provider,
      allProviders: params.allProviders,
      systemPrompt: params.systemPrompt,
      conversationSummary: params.conversationSummary,
      messages: params.messages,
    },
    { immediate: true },
  );
  const persistOutcome = await params.persistRegistryBestEffort(params.persistContext);
  params.scheduleSessionContextEvictionWhenDurable(params.sessionId, persistOutcome);
}

export async function finalizeCompletedSubAgentRun<TAgent extends SubAgentSnapshot>(params: {
  sessionId: string;
  depth: number;
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  transcriptMessages: Message[];
  output: string;
  completionState?: SubAgentCompletionState;
  toolsUsed: string[];
  iterations: number;
  subAgent: TAgent;
  outputTruncation: number;
  shouldAnnounce: boolean;
  refreshArtifacts: (agent: TAgent, transcriptMessages: Message[]) => void;
  announce: (agent: TAgent, event: TerminalAnnouncement) => void;
  scheduleSessionContextCheckpoint: (
    context: SessionContextStoreParams,
    options: { immediate: boolean },
  ) => void;
  persistRegistryBestEffort: (context: string) => Promise<PersistRegistryBestEffortOutcome>;
  scheduleSessionContextEvictionWhenDurable: (
    sessionId: string,
    persistOutcome: PersistRegistryBestEffortOutcome,
  ) => void;
}): Promise<SubAgentResult> {
  const uniqueToolsUsed = [...new Set(params.toolsUsed)];
  const truncatedOutput = truncateSubAgentOutput(params.output, params.outputTruncation);
  const updatedAt = Date.now();

  params.refreshArtifacts(params.subAgent, params.transcriptMessages);
  params.subAgent.status = 'completed';
  params.subAgent.output = truncatedOutput;
  params.subAgent.completionState = params.completionState;
  params.subAgent.toolsUsed = uniqueToolsUsed;
  params.subAgent.iterations = params.iterations;
  params.subAgent.launchState = 'terminal';
  params.subAgent.modelResponsePendingSince = undefined;
  params.subAgent.currentActivity = undefined;
  params.subAgent.activeToolName = undefined;
  params.subAgent.activeToolStartedAt = undefined;
  params.subAgent.updatedAt = updatedAt;

  await persistTerminalSessionContext({
    sessionId: params.sessionId,
    config: params.config,
    provider: params.provider,
    allProviders: params.allProviders,
    systemPrompt: params.systemPrompt,
    conversationSummary: truncatedOutput,
    messages: params.transcriptMessages,
    persistContext: 'Persisting completed worker state failed',
    scheduleSessionContextCheckpoint: params.scheduleSessionContextCheckpoint,
    persistRegistryBestEffort: params.persistRegistryBestEffort,
    scheduleSessionContextEvictionWhenDurable: params.scheduleSessionContextEvictionWhenDurable,
  });

  if (params.shouldAnnounce) {
    params.announce(params.subAgent, 'completed');
  }

  return buildTerminalResult(
    params.sessionId,
    truncatedOutput,
    params.completionState,
    uniqueToolsUsed,
    params.iterations,
    'completed',
    params.depth,
    params.subAgent.artifacts,
  );
}

export async function finalizeFailedSubAgentRun<TAgent extends SubAgentSnapshot>(params: {
  sessionId: string;
  depth: number;
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  transcriptMessages: Message[];
  output: string;
  completionState?: SubAgentCompletionState;
  toolsUsed: string[];
  iterations: number;
  status: Exclude<SubAgentResult['status'], 'completed'>;
  error?: string;
  terminalMessage: string;
  subAgent: TAgent;
  outputTruncation: number;
  maxToolResultPreviewChars: number;
  shouldAnnounce: boolean;
  refreshArtifacts: (agent: TAgent, transcriptMessages: Message[]) => void;
  appendActivity: (agent: TAgent, kind: 'status', text: string) => void;
  normalizePreviewText: (text: string, maxChars: number) => string | undefined;
  announce: (agent: TAgent, event: TerminalAnnouncement) => void;
  scheduleSessionContextCheckpoint: (
    context: SessionContextStoreParams,
    options: { immediate: boolean },
  ) => void;
  persistRegistryBestEffort: (context: string) => Promise<PersistRegistryBestEffortOutcome>;
  scheduleSessionContextEvictionWhenDurable: (
    sessionId: string,
    persistOutcome: PersistRegistryBestEffortOutcome,
  ) => void;
}): Promise<SubAgentResult> {
  const uniqueToolsUsed = [...new Set(params.toolsUsed)];
  const truncatedOutput = truncateSubAgentOutput(params.output, params.outputTruncation);
  const terminalOutput = truncatedOutput || params.terminalMessage;
  const updatedAt = Date.now();

  params.refreshArtifacts(params.subAgent, params.transcriptMessages);
  params.subAgent.status = params.status;
  params.subAgent.output = terminalOutput;
  params.subAgent.completionState = params.completionState;
  params.subAgent.toolsUsed = uniqueToolsUsed;
  params.subAgent.iterations = params.iterations;
  params.subAgent.launchState = 'terminal';
  params.subAgent.modelResponsePendingSince = undefined;
  params.subAgent.currentActivity = params.normalizePreviewText(
    params.terminalMessage,
    params.maxToolResultPreviewChars,
  );
  params.subAgent.activeToolName = undefined;
  params.subAgent.activeToolStartedAt = undefined;
  params.subAgent.updatedAt = updatedAt;
  params.appendActivity(params.subAgent, 'status', params.terminalMessage);

  await persistTerminalSessionContext({
    sessionId: params.sessionId,
    config: params.config,
    provider: params.provider,
    allProviders: params.allProviders,
    systemPrompt: params.systemPrompt,
    conversationSummary: terminalOutput,
    messages: params.transcriptMessages,
    persistContext: 'Persisting terminal worker state failed',
    scheduleSessionContextCheckpoint: params.scheduleSessionContextCheckpoint,
    persistRegistryBestEffort: params.persistRegistryBestEffort,
    scheduleSessionContextEvictionWhenDurable: params.scheduleSessionContextEvictionWhenDurable,
  });

  if (params.shouldAnnounce) {
    params.announce(
      params.subAgent,
      params.status === 'cancelled'
        ? 'cancelled'
        : params.status === 'timeout'
          ? 'timeout'
          : 'error',
    );
  }

  return buildTerminalResult(
    params.sessionId,
    terminalOutput,
    params.completionState,
    uniqueToolsUsed,
    params.iterations,
    params.status,
    params.depth,
    params.subAgent.artifacts,
    params.error,
  );
}
