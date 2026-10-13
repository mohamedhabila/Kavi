import type { RequestFrame } from '../../services/agents/requestFrame';
import type { AgentPlanStep } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { ThinkingLevel } from '../thinking';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import type { PreparedAgentTurn } from './agentTurnPreparation';
import type { WorkflowTaskAnchor } from './workflowTaskAnchor';
import type { SessionMemoryRead } from '../../services/memory/memoryAccessGateway';

export type PromptContextSupport = {
  /** The run's plan, read from the graph each turn. */
  graphPlan?: ReadonlyArray<AgentPlanStep>;
  /** What the run read from memory for its prompt. */
  memory?: SessionMemoryRead;
  maxToolIterations: number;
  resolvedPrompt: string;
  runtimeContext?: string | null;
  skillPrompts: string;
  workflowTaskAnchor?: WorkflowTaskAnchor;
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
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
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
}
