import { useMemo, type MutableRefObject } from 'react';
import { computeTemporalMarkers, type TemporalMarker } from '../../components/chat/temporalMarkers';
import {
  computePersonaSwitchMarkers,
  type PersonaSwitchMarker,
} from '../../components/chat/personaSwitchMarkers';
import { getAvailablePersonasForConfig } from '../../services/agents/registry';
import {
  cloneSubAgentSnapshot,
  collectSubAgentSnapshotsFromMessages,
  resolveDisplayedSubAgentSnapshot,
} from '../../services/agents/lifecycle/stateMachine';
import { usePersonaConfigStore } from '../../services/agents/store';
import { getConversationWorkspaceFallbackConversationIds } from '../../services/conversationWorkspace/fallbacks';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import {
  buildAgentRunDisplayItemMap,
  getStableDisplayMessages,
  getVisibleSourceMessageWindow,
  resolveDisplayMessages,
  type ChatDisplayStateCache,
  type ResolvedDisplayMessageItem,
  type StreamingDraft,
} from '../chatScreenDisplayState';

type SubAgentSnapshot = NonNullable<Message['subAgentEvent']>['snapshot'];

type UseChatScreenPresentationStateParams = {
  activeConversation?: Conversation;
  activeConversationId: string | null;
  displayStateCacheRef: MutableRefObject<ChatDisplayStateCache>;
  liveSubAgentSnapshotsById: ReadonlyMap<string, SubAgentSnapshot>;
  personaCustomList: ReturnType<typeof usePersonaConfigStore.getState>['customPersonas'];
  personaOverrides: ReturnType<typeof usePersonaConfigStore.getState>['overrides'];
  streamingDrafts: Record<string, StreamingDraft>;
  streamingMessageId: string | null;
  visibleSourceMessageLimit: number;
};

type ChatScreenPresentationState = {
  availableSubAgentSnapshotsById: Map<string, SubAgentSnapshot>;
  hiddenSourceMessageCount: number;
  messages: Message[];
  personaSwitchMarkersByMessageId: Map<string, PersonaSwitchMarker>;
  resolvedDisplayMessages: ResolvedDisplayMessageItem[];
  temporalMarkersByMessageId: Map<string, TemporalMarker>;
  workspaceFallbackConversationIds: string[];
};

export function useChatScreenPresentationState(
  params: UseChatScreenPresentationStateParams,
): ChatScreenPresentationState {
  const messages = useMemo(
    () => params.activeConversation?.messages ?? [],
    [params.activeConversation?.messages],
  );
  const availableSubAgentSnapshotsById = useMemo(() => {
    const snapshotsById = new Map<string, SubAgentSnapshot>();

    for (const snapshot of collectSubAgentSnapshotsFromMessages(messages)) {
      snapshotsById.set(snapshot.sessionId, snapshot);
    }

    for (const liveSnapshot of params.liveSubAgentSnapshotsById.values()) {
      const existingSnapshot = snapshotsById.get(liveSnapshot.sessionId);
      snapshotsById.set(
        liveSnapshot.sessionId,
        existingSnapshot
          ? resolveDisplayedSubAgentSnapshot(existingSnapshot, liveSnapshot)
          : cloneSubAgentSnapshot(liveSnapshot),
      );
    }

    return snapshotsById;
  }, [params.liveSubAgentSnapshotsById, messages]);
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const visibleMessageWindow = useMemo(
    () => getVisibleSourceMessageWindow(messages, params.visibleSourceMessageLimit),
    [messages, params.visibleSourceMessageLimit],
  );
  const visibleDisplayMessages = useMemo(
    () =>
      getStableDisplayMessages(
        visibleMessageWindow.visibleMessages,
        params.displayStateCacheRef.current,
      ),
    [params.displayStateCacheRef, visibleMessageWindow.visibleMessages],
  );
  const agentRunByDisplayItemId = useMemo(
    () =>
      buildAgentRunDisplayItemMap(
        messages,
        visibleDisplayMessages,
        params.activeConversation?.agentRuns ?? [],
      ),
    [params.activeConversation?.agentRuns, messages, visibleDisplayMessages],
  );
  const resolvedDisplayMessages = useMemo(
    () =>
      resolveDisplayMessages({
        displayMessages: visibleDisplayMessages,
        messageById,
        cache: params.displayStateCacheRef.current,
        streamingDrafts: params.streamingDrafts,
        streamingMessageId: params.streamingMessageId,
        liveSubAgentSnapshotsById: params.liveSubAgentSnapshotsById,
        agentRunByDisplayItemId,
      }),
    [
      agentRunByDisplayItemId,
      messageById,
      params.displayStateCacheRef,
      params.liveSubAgentSnapshotsById,
      params.streamingDrafts,
      params.streamingMessageId,
      visibleDisplayMessages,
    ],
  );
  const temporalMarkersByMessageId = useMemo(() => {
    const markers = computeTemporalMarkers(
      resolvedDisplayMessages.map((item) => item.resolvedMessage),
    );
    const markerMap = new Map<string, TemporalMarker>();

    for (const marker of markers) {
      markerMap.set(marker.beforeMessageId, marker);
    }

    return markerMap;
  }, [resolvedDisplayMessages]);
  const personaDisplayResolver = useMemo(() => {
    const personas = getAvailablePersonasForConfig(
      params.personaOverrides,
      params.personaCustomList,
    );
    const personasById = new Map(personas.map((persona) => [persona.id, persona.name] as const));

    return (personaId: string) => personasById.get(personaId);
  }, [params.personaCustomList, params.personaOverrides]);
  const personaSwitchMarkersByMessageId = useMemo(() => {
    const events = params.activeConversation?.personaEvents;
    if (!events?.length) {
      return new Map<string, PersonaSwitchMarker>();
    }

    const markers = computePersonaSwitchMarkers(
      resolvedDisplayMessages.map((item) => item.resolvedMessage),
      events,
      {
        resolveDisplayName: personaDisplayResolver,
      },
    );
    const markerMap = new Map<string, PersonaSwitchMarker>();

    for (const marker of markers) {
      markerMap.set(marker.beforeMessageId, marker);
    }

    return markerMap;
  }, [params.activeConversation?.personaEvents, personaDisplayResolver, resolvedDisplayMessages]);
  const workspaceFallbackConversationIds = useMemo(
    () =>
      getConversationWorkspaceFallbackConversationIds({
        conversationId: params.activeConversationId,
        messages: params.activeConversation?.messages,
        usageEntries: params.activeConversation?.usage?.entries,
        agentRuns: params.activeConversation?.agentRuns,
      }),
    [
      params.activeConversation?.agentRuns,
      params.activeConversation?.messages,
      params.activeConversation?.usage?.entries,
      params.activeConversationId,
    ],
  );

  return {
    availableSubAgentSnapshotsById,
    hiddenSourceMessageCount: visibleMessageWindow.hiddenSourceMessageCount,
    messages,
    personaSwitchMarkersByMessageId,
    resolvedDisplayMessages,
    temporalMarkersByMessageId,
    workspaceFallbackConversationIds,
  };
}
