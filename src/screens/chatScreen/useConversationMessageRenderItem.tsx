import { useCallback, useRef } from 'react';
import type { Attachment } from '../../types/attachment';
import type { Message } from '../../types/message';
import type { PersonaSwitchMarker } from '../../components/chat/personaSwitchMarkers';
import type { TemporalMarker } from '../../components/chat/temporalMarkers';
import type { ResolvedDisplayMessageItem } from '../chatScreenDisplayState';
import type { createStyles } from '../ChatScreen.styles';
import { ConversationMessageRow } from './ConversationMessageRow';
import type { MemoryRetrievalFeedbackChoice } from '../../services/memory/retrievalOutcomeStore';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type RenderMessageContext = {
  handleEdit: (messageId: string, content: string) => void;
  handleOpenSubAgentDetails: (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => void;
  handleLoadMemoryFeedback: (
    messageId: string,
    eventId: string,
  ) => Promise<MemoryRetrievalFeedbackChoice | null>;
  handleMemoryFeedback: (
    messageId: string,
    eventId: string,
    outcome: MemoryRetrievalFeedbackChoice,
  ) => Promise<MemoryRetrievalFeedbackChoice>;
  handleRetry: (messageId: string) => Promise<void>;
  handleShareWorkspaceFile: (attachment: Attachment) => Promise<void>;
  handleViewCanvas: () => void;
  handleViewFiles: (path?: string) => void;
  personaSwitchMarkersByMessageId: Map<string, PersonaSwitchMarker>;
  styles: ReturnType<typeof createStyles>;
  t: TranslationFn;
  temporalMarkersByMessageId: Map<string, TemporalMarker>;
};

type UseConversationMessageRenderItemParams = RenderMessageContext;

export function useConversationMessageRenderItem(params: UseConversationMessageRenderItemParams) {
  const renderMessageContextRef = useRef<RenderMessageContext>(params);
  renderMessageContextRef.current = params;

  return useCallback(({ item }: { item: ResolvedDisplayMessageItem }) => {
    const renderContext = renderMessageContextRef.current;
    const marker = renderContext.temporalMarkersByMessageId.get(item.resolvedMessage.id);
    const personaMarker = renderContext.personaSwitchMarkersByMessageId.get(
      item.resolvedMessage.id,
    );
    const personaMarkerText = personaMarker
      ? personaMarker.fromName
        ? renderContext.t('chat.personaSwitchEvent', {
            from: personaMarker.fromName,
            to: personaMarker.toName,
          })
        : renderContext.t('chat.personaSwitchEventInitial', { to: personaMarker.toName })
      : null;

    return (
      <ConversationMessageRow
        item={item}
        onEdit={renderContext.handleEdit}
        onOpenSubAgentDetails={renderContext.handleOpenSubAgentDetails}
        onLoadMemoryFeedback={renderContext.handleLoadMemoryFeedback}
        onMemoryFeedback={renderContext.handleMemoryFeedback}
        onRetry={renderContext.handleRetry}
        onShareWorkspaceFile={renderContext.handleShareWorkspaceFile}
        onViewCanvas={renderContext.handleViewCanvas}
        onViewFiles={renderContext.handleViewFiles}
        personaMarkerId={personaMarker?.id}
        personaMarkerText={personaMarkerText}
        styles={renderContext.styles}
        temporalMarkerBeforeMessageId={marker?.beforeMessageId}
        temporalMarkerKind={marker?.kind}
        temporalMarkerText={marker?.text}
      />
    );
  }, []);
}
