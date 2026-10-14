import { AgentRunAsyncOperation } from '../../../types/agentRun';
import type { MobileControllerHostPort } from '../../mobileController/runtimeBinding';
import type { MobileControllerOutcome } from '../../mobileController/contracts';
import type { AgentRunMobileControllerHandoffRef } from '../../../types/agentRun';
import type { TurnLatencyTimeline } from '../../turnLatencyTimeline';

export type AssistantDraftMode = 'continue' | 'new';

export type MobileControllerOutcomeSubmission = Readonly<{
  handoff: AgentRunMobileControllerHandoffRef;
  outcome: MobileControllerOutcome;
}>;

export type RunChatOptions = {
  maxTokens?: number;
  reuseAgentRunId?: string;
  assistantDraftMode?: AssistantDraftMode;
  additionalSystemPrompt?: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
  allowedToolNames?: ReadonlyArray<string>;
  enableCompaction?: boolean;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
  /** Optional permitted host controller for this exact foreground execution. */
  mobileController?: MobileControllerHostPort;
  /** The published handoff identity paired with correlated host-observed facts. */
  mobileControllerOutcome?: MobileControllerOutcomeSubmission;
  /**
   * Started when the user sent this turn, so its marks include the send-path waits.
   * A run started without one (a resume, retry, or recovery) times from its own start.
   */
  latencyTimeline?: TurnLatencyTimeline;
};

export type ResumeAgentRun = (params: {
  conversationId: string;
  runId: string;
  additionalSystemPrompt: string;
  additionalUserPrompt?: string;
  disableTools?: boolean;
  assistantDraftMode: AssistantDraftMode;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
}) => Promise<void>;
