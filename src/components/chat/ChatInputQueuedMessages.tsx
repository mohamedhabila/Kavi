import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Pencil } from 'lucide-react-native';
import type { AppPalette } from '../../theme/useAppTheme';
import type { ChatInputStyles } from './ChatInput.styles';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

export type ChatInputQueuedMessage = Readonly<{ id: string; text: string }>;

/**
 * Messages sent while the assistant works, waiting for it to read them at its next step.
 * Editing one takes it out of the queue and back into the composer.
 */
export function ChatInputQueuedMessages(props: {
  colors: AppPalette;
  messages: ReadonlyArray<ChatInputQueuedMessage>;
  onEdit: (messageId: string) => void;
  styles: ChatInputStyles;
  t: TranslationFn;
}) {
  if (props.messages.length === 0) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={props.styles.queuedMessages}
      testID="chat-queued-messages"
    >
      <Text style={props.styles.queuedMessagesTitle}>{props.t('chat.steeringQueuedTitle')}</Text>
      {props.messages.map((message) => (
        <View key={message.id} style={props.styles.queuedMessageRow}>
          <Text numberOfLines={2} style={props.styles.queuedMessageText}>
            {message.text}
          </Text>
          <TouchableOpacity
            accessibilityLabel={props.t('chat.steeringEditQueued')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => props.onEdit(message.id)}
            style={props.styles.queuedMessageEdit}
            testID={`chat-queued-message-edit-${message.id}`}
          >
            <Pencil size={16} color={props.colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}
