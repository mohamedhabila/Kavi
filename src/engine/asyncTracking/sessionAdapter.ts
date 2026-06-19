import { extractStringArg } from './support';
import { deleteTrackedAsyncOperationsByKind } from './trackerStore';
import type { TrackedAsyncOperation } from './types';
import {
  markMissingTrackedSessionFailed,
  readSessionStatus,
  updateTrackedSessionsFromCollection,
  upsertTrackedSession,
} from './sessionAdapterSupport';

export function applyTrackedSessionToolResult(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  toolArguments: string,
  toolResult: string,
  parsedResult: Record<string, unknown> | undefined,
): boolean {
  if (!/^sessions_/.test(toolName)) {
    return false;
  }

  const fallbackSessionId = extractStringArg(toolArguments, 'sessionId');

  switch (toolName) {
    case 'sessions_spawn':
    case 'sessions_send': {
      const sessionId =
        typeof parsedResult?.sessionId === 'string' ? parsedResult.sessionId.trim() : undefined;
      const status = readSessionStatus(parsedResult?.status);
      if (sessionId && status) {
        upsertTrackedSession(trackedOperations, { sessionId, status, toolName, toolArguments });
      }
      return true;
    }

    case 'sessions_status':
    case 'sessions_history':
    case 'sessions_output':
    case 'sessions_surface_output':
    case 'sessions_cancel': {
      const sessionId =
        typeof parsedResult?.sessionId === 'string'
          ? parsedResult.sessionId.trim()
          : fallbackSessionId;
      const status = readSessionStatus(parsedResult?.status);
      if (sessionId && status) {
        upsertTrackedSession(trackedOperations, { sessionId, status, toolName, toolArguments });
      }
      markMissingTrackedSessionFailed(trackedOperations, toolName, toolArguments, toolResult);
      return true;
    }

    case 'sessions_wait': {
      const sessionCount =
        typeof parsedResult?.sessionCount === 'number' ? parsedResult.sessionCount : undefined;
      const waitedForConversationSessions = parsedResult?.waitedForConversationSessions === true;
      if (
        parsedResult?.status === 'completed' &&
        waitedForConversationSessions &&
        sessionCount === 0
      ) {
        deleteTrackedAsyncOperationsByKind(trackedOperations, 'session');
        return true;
      }

      updateTrackedSessionsFromCollection(
        trackedOperations,
        parsedResult?.sessions,
        toolName,
        toolArguments,
      );
      return true;
    }

    case 'sessions_yield': {
      const status =
        typeof parsedResult?.status === 'string' ? parsedResult.status.trim().toLowerCase() : '';
      const pendingSessions = Array.isArray(parsedResult?.pendingSessions)
        ? parsedResult.pendingSessions
        : undefined;

      if (status === 'completed' && pendingSessions?.length === 0) {
        deleteTrackedAsyncOperationsByKind(trackedOperations, 'session');
        return true;
      }

      updateTrackedSessionsFromCollection(
        trackedOperations,
        pendingSessions,
        toolName,
        toolArguments,
      );
      return true;
    }

    case 'sessions_list':
      updateTrackedSessionsFromCollection(
        trackedOperations,
        parsedResult?.sessions,
        toolName,
        toolArguments,
      );
      return true;

    default:
      return false;
  }
}
