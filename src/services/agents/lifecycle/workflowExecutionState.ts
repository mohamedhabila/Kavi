import type { AgentRunWorkstream } from '../../../types/agentRun';
import type { SubAgentSnapshot, SubAgentStatus } from '../../../types/subAgent';
import { outputSatisfiesExpectedText } from '../../../utils/outputContract';
import { resolveWorkflowWorkstreamReference } from '../workflowSchedulingReferences';
import type {
  WorkflowExecutionState,
  WorkflowExecutionStatus,
} from '../workflowSchedulingTypes';

function summarizeExecutionStatus(
  snapshotStatus: SubAgentStatus,
): Exclude<WorkflowExecutionStatus, 'not-started'> {
  if (snapshotStatus === 'running') {
    return 'running';
  }

  if (snapshotStatus === 'completed') {
    return 'completed';
  }

  return 'failed';
}

export function createWorkflowExecutionState(
  workstreamId: string,
  title?: string,
): WorkflowExecutionState {
  return {
    workstreamId,
    title,
    status: 'not-started',
    completedByGraph: false,
    runningSessionIds: [],
    completedSessionIds: [],
    failedSessionIds: [],
  };
}

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getWorkflowExecutionStates(
  workstreams: ReadonlyArray<AgentRunWorkstream>,
  workers: ReadonlyArray<
    Pick<SubAgentSnapshot, 'workstreamId' | 'sessionId' | 'status' | 'output'>
  >,
  completedWorkstreamIds: ReadonlyArray<string> = [],
): Record<string, WorkflowExecutionState> {
  const states: Record<string, WorkflowExecutionState> = {};

  for (const workstream of workstreams) {
    states[workstream.id] = createWorkflowExecutionState(workstream.id, workstream.title);
  }

  for (const completedWorkstreamId of completedWorkstreamIds) {
    const rawWorkstreamId = trimText(completedWorkstreamId);
    const workstreamId = rawWorkstreamId
      ? (resolveWorkflowWorkstreamReference(workstreams, rawWorkstreamId) ?? rawWorkstreamId)
      : undefined;
    if (!workstreamId) {
      continue;
    }

    const currentState = states[workstreamId] ?? createWorkflowExecutionState(workstreamId);
    currentState.completedByGraph = true;
    if (currentState.runningSessionIds.length === 0) {
      currentState.status = 'completed';
    }
    states[workstreamId] = currentState;
  }

  for (const worker of workers) {
    const rawWorkstreamId = trimText(worker.workstreamId);
    const workstreamId = rawWorkstreamId
      ? (resolveWorkflowWorkstreamReference(workstreams, rawWorkstreamId) ?? rawWorkstreamId)
      : undefined;
    if (!workstreamId) {
      continue;
    }

    const currentState = states[workstreamId] ?? createWorkflowExecutionState(workstreamId);
    const workstream = workstreams.find((candidate) => candidate.id === workstreamId);
    const executionStatus = summarizeExecutionStatus(worker.status);
    const workerSatisfiedExpectedOutput =
      executionStatus !== 'completed' ||
      outputSatisfiesExpectedText({
        output: worker.output,
        expectedText: workstream?.expectedOutput,
      });

    switch (executionStatus) {
      case 'running':
        currentState.runningSessionIds.push(worker.sessionId);
        break;
      case 'completed':
        if (workerSatisfiedExpectedOutput) {
          currentState.completedSessionIds.push(worker.sessionId);
        } else {
          currentState.failedSessionIds.push(worker.sessionId);
        }
        break;
      case 'failed':
        currentState.failedSessionIds.push(worker.sessionId);
        break;
      default:
        break;
    }

    currentState.status =
      currentState.runningSessionIds.length > 0
        ? 'running'
        : currentState.completedSessionIds.length > 0
          ? 'completed'
          : currentState.completedByGraph
            ? 'completed'
            : currentState.failedSessionIds.length > 0
              ? 'failed'
              : 'not-started';

    states[workstreamId] = currentState;
  }

  return states;
}
