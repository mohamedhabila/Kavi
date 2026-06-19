import {
  normalizeAgentRunAsyncOperations,
  normalizeAgentRunControlGraphAsyncWorkState,
} from '../../services/agents/agentRunAsyncState';
import { appendAudit, getTimestamp } from './agentControlGraphInternals';
import {
  assignAgentControlGraph,
  type AgentControlGraphAssignArgs,
} from './agentControlGraphAssign';

export const createRecordAsyncWaitingAction = () =>
  assignAgentControlGraph(({ context, event }: AgentControlGraphAssignArgs) => {
    if (event.type !== 'ASYNC_WAITING') {
      return {};
    }
    const pendingOperations =
      event.pendingOperations !== undefined
        ? normalizeAgentRunAsyncOperations(event.pendingOperations) ?? []
        : context.asyncWork.pendingOperations;
    const pendingAsyncCount =
      event.pendingOperations !== undefined
        ? pendingOperations.length
        : Math.max(0, event.pendingAsyncCount);
    const timestamp = getTimestamp(event);
    return {
      pendingAsyncCount,
      asyncWork: normalizeAgentRunControlGraphAsyncWorkState({
        ...context.asyncWork,
        awaitingBackgroundWorkers:
          event.awaitingBackgroundWorkers ?? context.asyncWork.awaitingBackgroundWorkers,
        pendingOperations,
        updatedAt: timestamp,
      }),
      updatedAt: timestamp,
      audit: appendAudit(context.audit, event, `${pendingAsyncCount} pending`),
    };
  });
