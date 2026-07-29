import React from 'react';
import { Modal, Pressable, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Braces, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppPalette } from '../../theme/useAppTheme';
import type { ChatInputStyles } from './ChatInput.styles';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatInputOptionsSheetProps = {
  colors: AppPalette;
  exactText: boolean;
  onChangeExactText: (exactText: boolean) => void;
  onClose: () => void;
  styles: ChatInputStyles;
  t: TranslationFn;
  visible: boolean;
};

export function ChatInputOptionsSheet(props: ChatInputOptionsSheetProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      statusBarTranslucent
      transparent
      visible={props.visible}
    >
      <View style={props.styles.optionsOverlay}>
        <Pressable
          accessibilityLabel={props.t('common.close')}
          accessibilityRole="button"
          onPress={props.onClose}
          style={props.styles.optionsBackdrop}
          testID="chat-input-options-backdrop"
        />
        <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={props.styles.optionsSheet}>
          <View style={props.styles.optionsHandle} />
          <View style={props.styles.optionsHeader}>
            <Text style={props.styles.optionsTitle}>{props.t('chat.inputOptions')}</Text>
            <TouchableOpacity
              accessibilityLabel={props.t('common.close')}
              accessibilityRole="button"
              onPress={props.onClose}
              style={props.styles.optionsClose}
              testID="chat-close-input-options"
            >
              <X size={22} color={props.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={props.styles.optionsRow}>
            <View style={props.styles.optionsRowIcon}>
              <Braces size={20} color={props.colors.primary} />
            </View>
            <View style={props.styles.optionsRowContent}>
              <Text style={props.styles.optionsRowTitle}>{props.t('chat.exactText')}</Text>
              <Text style={props.styles.optionsRowHint}>{props.t('chat.exactTextHint')}</Text>
            </View>
            <Switch
              accessibilityHint={props.t('chat.exactTextHint')}
              accessibilityLabel={props.t('chat.exactText')}
              accessibilityState={{ checked: props.exactText }}
              onValueChange={props.onChangeExactText}
              testID="chat-exact-text-switch"
              thumbColor={props.exactText ? props.colors.onPrimary : undefined}
              trackColor={{ false: props.colors.border, true: props.colors.primary }}
              value={props.exactText}
            />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

type ChatInputExactTextIndicatorProps = {
  colors: AppPalette;
  onDisable: () => void;
  styles: ChatInputStyles;
  t: TranslationFn;
};

export function ChatInputExactTextIndicator(props: ChatInputExactTextIndicatorProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={props.styles.exactTextBanner}
      testID="chat-exact-text-indicator"
    >
      <Braces size={18} color={props.colors.primary} />
      <View style={props.styles.exactTextBannerContent}>
        <Text style={props.styles.exactTextBannerTitle}>{props.t('chat.exactText')}</Text>
        <Text style={props.styles.exactTextBannerHint}>{props.t('chat.exactTextActiveHint')}</Text>
      </View>
      <TouchableOpacity
        accessibilityLabel={props.t('chat.disableExactText')}
        accessibilityRole="button"
        onPress={props.onDisable}
        style={props.styles.exactTextBannerDismiss}
        testID="chat-disable-exact-text"
      >
        <X size={18} color={props.colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}
