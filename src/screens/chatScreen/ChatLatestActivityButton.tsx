import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowDown } from 'lucide-react-native';
import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

/** Gap between the button and the bottom of the transcript, just above the composer. */
const TRANSCRIPT_BOTTOM_GAP = 12;

type ChatLatestActivityButtonProps = {
  colors: AppPalette;
  onPress: () => void;
  t: TranslationFn;
  visible: boolean;
};

export const ChatLatestActivityButton = React.memo(function ChatLatestActivityButton(
  props: ChatLatestActivityButtonProps,
) {
  if (!props.visible) {
    return null;
  }

  const label = props.t('chat.jumpToLatest');

  return (
    <View pointerEvents="box-none" style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={props.onPress}
        style={[
          styles.button,
          {
            backgroundColor: props.colors.surface,
            borderColor: props.colors.border,
            shadowColor: props.colors.mode === 'dark' ? '#000000' : props.colors.text,
          },
        ]}
        testID="chat-jump-to-latest"
      >
        <ArrowDown size={16} color={props.colors.primary} />
        <Text style={[styles.label, { color: props.colors.primary }]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: TRANSCRIPT_BOTTOM_GAP,
    left: 0,
    right: 0,
    zIndex: 4,
    elevation: 4,
    alignItems: 'center',
  },
  button: {
    minHeight: 44,
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
});
