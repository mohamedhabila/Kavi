import type {
  AgentGoal,
  AgentRunAsyncOperation,
  AgentRunControlGraphAuditEvent,
  AgentRunControlGraphPerformance,
  AgentRunControlGraphState,
  AgentRunControlGraphStatus,
  AgentRunControlGraphToolCallRef,
  AgentRunControlGraphToolResultRef,
  AgentRunControlGraphTurnDirectives,
} from '../../types/agentRun';

export type AgentControlGraphStatus = AgentRunControlGraphStatus;
export type AgentControlToolCallRef = AgentRunControlGraphToolCallRef;
export type AgentControlToolResultRef = AgentRunControlGraphToolResultRef;
export type AgentControlAuditEvent = AgentRunControlGraphAuditEvent;
export type AgentControlGraphSnapshot = AgentRunControlGraphState;
export type AgentControlTurnDirectives = AgentRunControlGraphTurnDirectives;
export type AgentControlPerformance = AgentRunControlGraphPerformance;

export type AgentControlGraphRuntimeCommand =
  | {
      type: 'blocked';
      reason: string;
    }
  | {
      type: 'terminal';
      status: Extract<
        AgentControlGraphStatus,
        'blocked' | 'finalized' | 'yielded' | 'cancelled' | 'failed'
      >;
      reason: string;
    }
  | {
      type: 'start_model_turn';
      directives: AgentControlTurnDirectives;
    };

export type AgentControlGraphEvent =
  | {
      type: 'MODEL_TURN_STARTED';
      iteration: number;
      toolNames?: string[];
      timestamp?: number;
    }
  | {
      type: 'MODEL_TURN_COMPLETED';
      iteration: number;
      toolCalls?: AgentControlToolCallRef[];
      timestamp?: number;
    }
  | {
      type: 'MODEL_TURN_FAILED';
      iteration: number;
      reason: string;
      timestamp?: number;
    }
  | {
      type: 'TOOL_RESULT_RECORDED';
      result: AgentControlToolResultRef;
      timestamp?: number;
    }
  | {
      type: 'TOOL_RESULTS_RECORDED';
      results: AgentControlToolResultRef[];
      timestamp?: number;
    }
  | {
      type: 'FINALIZATION_HELD';
      reason: string;
      timestamp?: number;
    }
  | {
      type: 'FINAL_CANDIDATE_READY';
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'GOALS_UPDATED';
      goals: AgentGoal[];
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'SESSION_ACTIVATED_TOOLS_UPDATED';
      toolNames: string[];
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'GOAL_EVIDENCE_ADDED';
      goalId: string;
      evidence: string;
      timestamp?: number;
    }
  | {
      type: 'PERFORMANCE_METRICS_RECORDED';
      metrics: Partial<AgentControlPerformance>;
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'GRAPH_OBSERVABILITY_RECORDED';
      observabilityType: string;
      iteration?: number;
      detail?: string;
      timestamp?: number;
    }
  | {
      type: 'TURN_DIRECTIVES_RECORDED';
      directives: Partial<AgentControlTurnDirectives>;
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'TURN_DIRECTIVES_CONSUMED';
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'ASYNC_WAITING';
      pendingAsyncCount: number;
      pendingOperations?: AgentRunAsyncOperation[];
      awaitingBackgroundWorkers?: boolean;
      timestamp?: number;
    }
  | {
      type: 'BLOCKED';
      reason: string;
      timestamp?: number;
    }
  | {
      type: 'FINALIZED';
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'YIELDED';
      reason?: string;
      timestamp?: number;
    }
  | {
      type: 'CANCELLED';
      reason: string;
      timestamp?: number;
    }
  | {
      type: 'FAILED';
      reason: string;
      timestamp?: number;
    };

export type AgentControlGraphMachineContext = AgentControlGraphSnapshot;
export type TerminalAgentControlGraphStatus = Extract<
  AgentControlGraphStatus,
  'blocked' | 'finalized' | 'yielded' | 'cancelled' | 'failed'
>;
export type TerminalAgentControlGraphEvent = Extract<
  AgentControlGraphEvent,
  | { type: 'BLOCKED' }
  | { type: 'FINALIZED' }
  | { type: 'YIELDED' }
  | { type: 'CANCELLED' }
  | { type: 'FAILED' }
>;
