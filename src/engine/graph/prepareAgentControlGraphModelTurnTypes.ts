import type { RequestFrame } from '../../services/agents/requestFrame';
import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { ThinkingLevel } from '../thinking';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import type { PreparedAgentTurn } from './agentTurnPreparation';
import type { VerifiedProcedureExecutionSession } from '../../services/memory/verifiedProcedure/executionSession';
import type { WorkflowTaskAnchor } from './workflowTaskAnchor';
import type { ConversationModeEscalation } from './conversation/modeEscalation';
import type { MemoryAuthoritySnapshot } from '../../services/memory/memoryAuthority';

export type LivingMemorySection = {
  text: string;
  cacheable?: boolean;
};

export type PromptContextSupport = {
  graphGoals?: ReadonlyArray<AgentGoal>;
  goalsPromptSection?: string | null;
  livingMemorySections?: ReadonlyArray<LivingMemorySection>;
  livingMemoryReadEpoch?: number;
  livingMemoryAuthoritySnapshot?: MemoryAuthoritySnapshot;
  livingMemoryValidUntil?: number;
  maxToolIterations: number;
  resolvedPrompt: string;
  runtimeContext?: string | null;
  skillPrompts: string;
  workflowTaskAnchor?: WorkflowTaskAnchor;
};

export type PreparedAgentControlGraphModelTurnReady = {
  /** Reported when a chitchat turn reached for capability only agentic runs may use. */
  modeEscalation: ConversationModeEscalation;
  effectiveForceTextThisTurn: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlTurnDirectives['forcedTextReason'];
  iterationThinkingLevel: ThinkingLevel;
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
  /** What the run may execute, as opposed to what this turn advertises. */
  authorizedToolNames: ReadonlySet<string>;
  preparedTurn: PreparedAgentTurn;
  requestMaxTokens: number;
  requestModel: string;
  toolingEnabledForProvider: boolean;
  toolSurfacePinTelemetry: {
    sessionPinnedCount: number;
    turnPinnedCount: number;
  };
};

export interface PrepareAgentControlGraphModelTurnParams {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  allTools: ReadonlyArray<ToolDefinition>;
  disableTooling?: boolean;
  completedWorkflowToolNames: ReadonlySet<string>;
  goals?: ReadonlyArray<AgentGoal>;
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  /** Whether the conversation this turn belongs to starts in agentic mode. */
  startsAgentic: boolean;
  /** True once this run escalated out of chitchat; keeps agentic authority for later iterations. */
  escalatedToAgentic?: boolean;
  iteration: number;
  maxTokens: number;
  personaThinkingLevel?: ThinkingLevel;
  promptContextSupport: PromptContextSupport;
  requestFrame: RequestFrame;
  thinkingLevel: ThinkingLevel;
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  turnDirectives: AgentControlTurnDirectives;
  sessionActivatedToolNames?: ReadonlyArray<string>;
  workingMessages: ReadonlyArray<Message>;
  verifiedProcedureSession?: VerifiedProcedureExecutionSession;
}
