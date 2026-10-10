import { useMemo, type MutableRefObject } from 'react';
import { computeTemporalMarkers, type TemporalMarker } from '../../components/chat/temporalMarkers';
import {
  computePersonaSwitchMarkers,
  type PersonaSwitchMarker,
} from '../../components/chat/personaSwitchMarkers';
import { getAvailablePersonasForConfig } from '../../services/agents/registry';
import { useTranslation } from '../../i18n/useTranslation';
import { getLocaleBcp47Tag } from '../../i18n/localeBcp47';
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
  selectAgentRunExecutionPresentation,
  type ActiveConversationExecutionState,
} from '../../services/agents/activeConversationExecutionState';
import {
  buildAgentRunDisplayItemMap,
  getStableDisplayMessages,
  getVisibleSourceMessageWindow,
  resolveDisplayMessages,
  type ChatDisplayStateCache,
  type ResolvedDisplayMessageItem,
  type StreamingDraft,
} from '../chatScreenDisplayState';
import { mergeChronologically } from '../../utils/messageChronology';
import { useArchivedTranscript } from './useArchivedTranscript';
import { isContinuableStop } from './continuableStop';

type SubAgentSnapshot = NonNullable<Message['subAgentEvent']>['snapshot'];

type UseChatScreenPresentationStateParams = {
  activeConversation?: Conversation;
  activeConversationId: string | null;
  displayStateCacheRef: MutableRefObject<ChatDisplayStateCache>;
  executionState: ActiveConversationExecutionState;
  liveSubAgentSnapshotsById: ReadonlyMap<string, SubAgentSnapshot>;
  personaCustomList: ReturnType<typeof usePersonaConfigStore.getState>['customPersonas'];
  personaOverrides: ReturnType<typeof usePersonaConfigStore.getState>['overrides'];
  streamingDrafts: Record<string, StreamingDraft>;
  streamingMessageId: string | null;
  visibleSourceMessageLimit: number;
};

type ChatScreenPresentationState = {
  availableSubAgentSnapshotsById: Map<string, SubAgentSnapshot>;
  /** Archived history not yet shown, available once the in-memory window is exhausted. */
  archivedEarlierMessageCount: number;
  /** Ids of displayed messages that come from the archive; they are read-only. */
  archivedMessageIds: ReadonlySet<string>;
  /** The latest answer, when it handed a task back unfinished and can be continued. */
  continuableMessageId: string | null;
  hiddenSourceMessageCount: number;
  loadEarlierArchivedMessages: () => void;
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
  const archivedTranscript = useArchivedTranscript(params.activeConversationId, messages);
  const archivedMessageIds = useMemo(
    () => new Set(archivedTranscript.messages.map((message) => message.id)),
    [archivedTranscript.messages],
  );
  const messageById = useMemo(
    () =>
      new Map(
        [...archivedTranscript.messages, ...messages].map((message) => [message.id, message]),
      ),
    [archivedTranscript.messages, messages],
  );
  const visibleMessageWindow = useMemo(() => {
    const window = getVisibleSourceMessageWindow(messages, params.visibleSourceMessageLimit);
    // Archived history sits before everything held in memory, so it joins only once the
    // in-memory window is fully shown.
    return window.hiddenSourceMessageCount > 0 || archivedTranscript.messages.length === 0
      ? window
      : {
          visibleMessages: mergeChronologically(
            archivedTranscript.messages,
            window.visibleMessages,
          ),
          hiddenSourceMessageCount: 0,
        };
  }, [archivedTranscript.messages, messages, params.visibleSourceMessageLimit]);
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
  const agentRunExecutionPresentationByDisplayItemId = useMemo(
    () =>
      new Map(
        Array.from(agentRunByDisplayItemId, ([displayItemId, run]) => [
          displayItemId,
          selectAgentRunExecutionPresentation(run, params.executionState),
        ]),
      ),
    [agentRunByDisplayItemId, params.executionState],
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
        agentRunExecutionPresentationByDisplayItemId,
      }),
    [
      agentRunByDisplayItemId,
      agentRunExecutionPresentationByDisplayItemId,
      messageById,
      params.displayStateCacheRef,
      params.liveSubAgentSnapshotsById,
      params.streamingDrafts,
      params.streamingMessageId,
      visibleDisplayMessages,
    ],
  );
  const continuableMessageId = useMemo(() => {
    const latest = resolvedDisplayMessages.at(-1);
    return latest &&
      !latest.isStreaming &&
      isContinuableStop(latest.resolvedMessage, latest.agentRun)
      ? latest.resolvedMessage.id
      : null;
  }, [resolvedDisplayMessages]);
  const { locale } = useTranslation();
  const temporalMarkersByMessageId = useMemo(() => {
    const markers = computeTemporalMarkers(
      resolvedDisplayMessages.map((item) => item.resolvedMessage),
      { locale: getLocaleBcp47Tag(locale) },
    );
    const markerMap = new Map<string, TemporalMarker>();

    for (const marker of markers) {
      markerMap.set(marker.beforeMessageId, marker);
    }

    return markerMap;
  }, [locale, resolvedDisplayMessages]);
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
    archivedEarlierMessageCount: archivedTranscript.remainingCount,
    archivedMessageIds,
    continuableMessageId,
    hiddenSourceMessageCount: visibleMessageWindow.hiddenSourceMessageCount,
    loadEarlierArchivedMessages: archivedTranscript.loadEarlier,
    messages,
    personaSwitchMarkersByMessageId,
    resolvedDisplayMessages,
    temporalMarkersByMessageId,
    workspaceFallbackConversationIds,
  };
}
