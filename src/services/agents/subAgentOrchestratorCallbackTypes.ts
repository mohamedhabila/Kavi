import type { Message, ToolCall } from '../../types/message';
import type { SubAgentActivityEntry, SubAgentConfig, SubAgentSnapshot } from '../../types/subAgent';
import type { TokenUsage } from '../../types/usage';
import type { SubAgentToolResultPreview } from './subAgentOutputContract';

export type SubAgentExecutionRuntimeState = {
  outputText: string;
  lastNonEmptyContent: string;
  finalNonEmptyContent: string;
  lastSubstantiveToolResult: string;
  iterations: number;
  lastTokenHeartbeatAt: number;
  lastTaskLedgerSignature: string;
  toolsUsed: string[];
  toolResultPreviews: SubAgentToolResultPreview[];
};

export type ProgressChanges<TAgent extends SubAgentSnapshot> = Partial<
  Pick<
    TAgent,
    | 'currentActivity'
    | 'activeToolName'
    | 'activeToolStartedAt'
    | 'lastToolResultPreview'
    | 'launchState'
    | 'modelResponsePendingSince'
    | 'taskLedger'
  >
>;

export type ProgressOptions = {
  activityKind?: SubAgentActivityEntry['kind'];
  activityText?: string;
  announce?: boolean;
  markProgress?: boolean;
};

export type SubAgentRunControl = {
  abortReason?: 'cancelled' | 'timeout' | 'max-iterations';
};

export type SubAgentOrchestratorCallbackParams<TAgent extends SubAgentSnapshot> = {
  abortController: AbortController;
  config: SubAgentConfig;
  providerId: string;
  sessionId: string;
  parentSessionId?: string;
  agentRunId?: string;
  subAgent: TAgent;
  runtimeState: SubAgentExecutionRuntimeState;
  maxIterations: number;
  maxToolResultPreviewChars: number;
  runControl: SubAgentRunControl;
  transcriptMessages: Message[];
  transcriptToolCalls: Map<string, ToolCall>;
  trackToolCall: (
    toolCallLike: Partial<ToolCall> | undefined,
    fallbackStatus: ToolCall['status'],
  ) => ToolCall;
  persistSessionContextNow: (conversationSummary?: string) => void;
  checkpointSessionContext: (conversationSummary?: string) => void;
  markModelResponseObserved: (agent: TAgent) => void;
  refreshSubAgentArtifacts: (agent: TAgent, messages: Message[]) => void;
  appendTranscriptMessage: (messages: Message[], message: Message) => void;
  appendActivity: (
    agent: TAgent,
    kind: SubAgentActivityEntry['kind'],
    text: string | undefined,
  ) => void;
  updateAgentProgress: (
    agent: TAgent,
    changes: ProgressChanges<TAgent>,
    options?: ProgressOptions,
  ) => void;
  recordUsage: (usage: TokenUsage) => void;
  reject: (error: Error) => void;
  resolve: () => void;
};
