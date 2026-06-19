export type WorkflowExecutionStatus = 'not-started' | 'running' | 'completed' | 'failed';

export interface WorkflowExecutionState {
  workstreamId: string;
  title?: string;
  status: WorkflowExecutionStatus;
  completedByGraph: boolean;
  runningSessionIds: string[];
  completedSessionIds: string[];
  failedSessionIds: string[];
}

export interface WorkflowBlockingDependency {
  workstreamId: string;
  title?: string;
  status: WorkflowExecutionStatus;
  sessionIds: string[];
}

export interface WorkflowSpawnGateResult {
  status: 'ready' | 'blocked';
  workstreamId?: string;
  dependencyIds: string[];
  unmetDependencyIds: string[];
  duplicateRunningSessionIds: string[];
  duplicateCompletedSessionIds: string[];
  duplicateCompletedWorkstreamIds: string[];
  blockingDependencies: WorkflowBlockingDependency[];
}

export interface WorkflowContinuationWorkstreamState extends WorkflowExecutionState {
  title: string;
  dependencyIds: string[];
  unmetDependencyIds: string[];
}

export interface WorkflowPlanContinuationResult {
  status: 'continue' | 'ready-for-pilot';
  hasStructuredPlan: boolean;
  totalWorkstreams: number;
  completedWorkstreams: WorkflowExecutionState[];
  runningWorkstreams: WorkflowContinuationWorkstreamState[];
  readyWorkstreams: WorkflowContinuationWorkstreamState[];
  blockedWorkstreams: WorkflowContinuationWorkstreamState[];
  summary: string;
}
