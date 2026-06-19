import React from 'react';
import { View } from 'react-native';
import { Copy, RotateCcw, Share2 } from 'lucide-react-native';
import type { AppPalette } from '../../theme/useAppTheme';
import type { AssistantBubbleStyles } from './AssistantBubble.styles';
import { MessageActionButton } from './MessageActionButton';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type AssistantBubbleActionsProps = {
  canCopy: boolean;
  canShare: boolean;
  colors: AppPalette;
  onCopy: () => void;
  onRetry?: () => void;
  onShare: () => void;
  styles: AssistantBubbleStyles;
  t: TranslationFn;
};

export const AssistantBubbleActions = React.memo(function AssistantBubbleActions(
  props: AssistantBubbleActionsProps,
) {
  return (
    <View style={[props.styles.actions, props.styles.actionsLeft]}>
      <MessageActionButton
        accessibilityLabel={props.t('chat.copyMessage')}
        disabled={!props.canCopy}
        onPress={props.onCopy}
      >
        <Copy size={16} color={props.colors.textTertiary} />
      </MessageActionButton>
      {props.canShare ? (
        <MessageActionButton
          accessibilityLabel={props.t('chat.shareMessage')}
          onPress={props.onShare}
        >
          <Share2 size={16} color={props.colors.textTertiary} />
        </MessageActionButton>
      ) : null}
      {props.onRetry ? (
        <MessageActionButton
          accessibilityLabel={props.t('chat.retryMessage')}
          onPress={props.onRetry}
        >
          <RotateCcw size={16} color={props.colors.textTertiary} />
        </MessageActionButton>
      ) : null}
    </View>
  );
});
