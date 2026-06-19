import { memo } from 'react';
import { Text, View } from 'react-native';
import { MessageBubble } from '../../components/chat/MessageBubble';
import type { Attachment } from '../../types/attachment';
import type { Message } from '../../types/message';
import type { ResolvedDisplayMessageItem } from '../chatScreenDisplayState';
import type { createStyles } from '../ChatScreen.styles';

type ConversationMessageRowProps = {
  item: ResolvedDisplayMessageItem;
  onEdit: (messageId: string, content: string) => void;
  onOpenSubAgentDetails: (snapshot: NonNullable<Message['subAgentEvent']>['snapshot']) => void;
  onRetry: (messageId: string) => void;
  onShareWorkspaceFile: (attachment: Attachment) => Promise<void>;
  onViewFiles: (path?: string) => void;
  personaMarkerId?: string;
  personaMarkerText?: string | null;
  styles: ReturnType<typeof createStyles>;
  temporalMarkerBeforeMessageId?: string;
  temporalMarkerKind?: string;
  temporalMarkerText?: string;
};

export const ConversationMessageRow = memo(function ConversationMessageRow(
  props: ConversationMessageRowProps,
) {
  return (
    <View>
      {props.temporalMarkerText ? (
        <View
          style={props.styles.temporalMarkerRow}
          testID={`temporal-marker-${props.temporalMarkerKind}-${props.temporalMarkerBeforeMessageId}`}
          accessibilityRole="text"
          accessibilityLabel={props.temporalMarkerText}
        >
          <View style={props.styles.temporalMarkerLine} />
          <Text style={props.styles.temporalMarkerText}>{props.temporalMarkerText}</Text>
          <View style={props.styles.temporalMarkerLine} />
        </View>
      ) : null}
      {props.personaMarkerId && props.personaMarkerText ? (
        <View
          style={props.styles.temporalMarkerRow}
          testID={`persona-switch-marker-${props.personaMarkerId}`}
          accessibilityRole="text"
          accessibilityLabel={props.personaMarkerText}
        >
          <View style={props.styles.temporalMarkerLine} />
          <Text style={props.styles.temporalMarkerText}>{props.personaMarkerText}</Text>
          <View style={props.styles.temporalMarkerLine} />
        </View>
      ) : null}
      <MessageBubble
        message={props.item.resolvedMessage}
        agentRun={props.item.agentRun}
        isStreaming={props.item.isStreaming}
        responseSegments={props.item.resolvedResponseSegments}
        onEdit={props.onEdit}
        onRetry={props.onRetry}
        onViewFile={props.onViewFiles}
        onShareWorkspaceFile={props.onShareWorkspaceFile}
        onOpenSubAgentDetails={props.onOpenSubAgentDetails}
        retryMessageId={props.item.retryMessageId}
      />
    </View>
  );
});
