import React from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Camera, FileText, Image as ImageIcon, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppPalette } from '../../theme/useAppTheme';
import type { ChatInputStyles } from './ChatInput.styles';
import type { ChatAttachSource } from './useChatInputAttachments';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatInputAttachSheetProps = {
  colors: AppPalette;
  onChoose: (source: ChatAttachSource) => void;
  onClose: () => void;
  /** Called once the sheet has finished closing (iOS reports this; see the hook). */
  onDismissed: () => void;
  styles: ChatInputStyles;
  t: TranslationFn;
  visible: boolean;
};

const ATTACH_OPTIONS: ReadonlyArray<{
  source: ChatAttachSource;
  labelKey: string;
  Icon: typeof Camera;
}> = [
  { source: 'camera', labelKey: 'chat.takePhoto', Icon: Camera },
  { source: 'library', labelKey: 'common.image', Icon: ImageIcon },
  { source: 'file', labelKey: 'common.file', Icon: FileText },
];

/**
 * Where an attachment comes from, as an in-app sheet. A system alert holds at most three
 * buttons on Android, so the four-button alert this replaces dropped Cancel there and could
 * not be dismissed; the sheet closes from its backdrop, its close button, or Back.
 */
export function ChatInputAttachSheet(props: ChatInputAttachSheetProps) {
  return (
    <Modal
      animationType="slide"
      onDismiss={props.onDismissed}
      onRequestClose={props.onClose}
      statusBarTranslucent
      transparent
      visible={props.visible}
    >
      <View style={props.styles.optionsOverlay}>
        <Pressable
          accessibilityLabel={props.t('common.cancel')}
          accessibilityRole="button"
          onPress={props.onClose}
          style={props.styles.optionsBackdrop}
          testID="chat-attach-sheet-backdrop"
        />
        <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={props.styles.optionsSheet}>
          <View style={props.styles.optionsHandle} />
          <View style={props.styles.optionsHeader}>
            <Text style={props.styles.optionsTitle}>{props.t('chat.attach')}</Text>
            <TouchableOpacity
              accessibilityLabel={props.t('common.cancel')}
              accessibilityRole="button"
              onPress={props.onClose}
              style={props.styles.optionsClose}
              testID="chat-attach-sheet-close"
            >
              <X size={22} color={props.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {ATTACH_OPTIONS.map(({ source, labelKey, Icon }) => (
            <TouchableOpacity
              accessibilityLabel={props.t(labelKey)}
              accessibilityRole="button"
              key={source}
              onPress={() => props.onChoose(source)}
              style={props.styles.optionsRow}
              testID={`chat-attach-source-${source}`}
            >
              <View style={props.styles.optionsRowIcon}>
                <Icon size={20} color={props.colors.primary} />
              </View>
              <View style={props.styles.optionsRowContent}>
                <Text style={props.styles.optionsRowTitle}>{props.t(labelKey)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
