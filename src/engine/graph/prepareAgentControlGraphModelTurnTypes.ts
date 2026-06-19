import type { RequestAssessmentAction } from '../../services/agents/requestGovernance';
import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { ThinkingLevel } from '../thinking';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import type { PreparedAgentTurn } from './agentTurnPreparation';

export type LivingMemorySection = {
  text: string;
  cacheable?: boolean;
};

export type PromptContextSupport = {
  conversationMemory: string | null;
  globalMemory: string | null;
  graphGoals?: ReadonlyArray<AgentGoal>;
  goalsPromptSection?: string | null;
  livingMemorySections?: ReadonlyArray<LivingMemorySection>;
  maxToolIterations: number;
  resolvedPrompt: string;
  runtimeContext?: string | null;
  skillPrompts: string;
};

export type PreparedAgentControlGraphModelTurnReady = {
  effectiveForceTextThisTurn: boolean;
  effectiveForceTextReasonThisTurn?: AgentControlTurnDirectives['forcedTextReason'];
  iterationThinkingLevel: ThinkingLevel;
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
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
  useExplicitFilteredToolSurface?: boolean;
  isSuperAgent: boolean;
  iteration: number;
  maxTokens: number;
  personaThinkingLevel?: ThinkingLevel;
  promptContextSupport: PromptContextSupport;
  requestAction: RequestAssessmentAction;
  thinkingLevel: ThinkingLevel;
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  turnDirectives: AgentControlTurnDirectives;
  sessionActivatedToolNames?: ReadonlyArray<string>;
  workingMessages: ReadonlyArray<Message>;
}
