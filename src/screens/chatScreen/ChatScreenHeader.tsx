import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  BarChart3,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Menu,
  MoreHorizontal,
  Settings2,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createStyles } from '../ChatScreen.styles';
import type { AppPalette } from '../../theme/useAppTheme';
import type { Conversation } from '../../types/conversation';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatScreenHeaderProps = {
  activeConversation?: Conversation;
  colors: AppPalette;
  isConversationBusy: boolean;
  onOpenConversationSettings: () => void;
  onOpenDeveloperTools: () => void;
  onOpenFiles: () => void;
  onOpenMenu: () => void;
  onOpenUsage: () => void;
  onToggleSideThread: () => void;
  styles: ReturnType<typeof createStyles>;
  t: TranslationFn;
};

type MenuRowProps = {
  Icon: typeof Settings2;
  danger?: boolean;
  label: string;
  onPress: () => void;
  props: ChatScreenHeaderProps;
  testID: string;
};

function ConversationMenuRow({ Icon, danger, label, onPress, props, testID }: MenuRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        props.styles.conversationMenuRow,
        pressed ? props.styles.conversationMenuRowPressed : null,
      ]}
      testID={testID}
    >
      <View style={props.styles.conversationMenuRowIcon}>
        <Icon size={20} color={danger ? props.colors.danger : props.colors.textSecondary} />
      </View>
      <Text
        numberOfLines={2}
        style={[
          props.styles.conversationMenuRowText,
          danger ? props.styles.conversationMenuRowDangerText : null,
        ]}
      >
        {label}
      </Text>
      <ChevronRight size={18} color={props.colors.textTertiary} />
    </Pressable>
  );
}

export function ChatScreenHeader(props: ChatScreenHeaderProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  const title = props.activeConversation?.title || props.t('nav.newChat');
  const status = props.isConversationBusy
    ? props.t('chat.headerStatusWorking')
    : props.t('chat.headerStatusReady');

  const runAndClose = (action: () => void) => {
    setMenuVisible(false);
    action();
  };

  return (
    <>
      <View style={props.styles.header} testID="chat-compact-header">
        <TouchableOpacity
          style={props.styles.headerButton}
          onPress={props.onOpenMenu}
          accessibilityRole="button"
          accessibilityLabel={props.t('chat.openMenu')}
          testID="chat-open-menu"
        >
          <Menu size={24} color={props.colors.text} />
        </TouchableOpacity>

        <View style={props.styles.headerCenter}>
          <Text style={props.styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
          <View
            accessibilityLiveRegion="polite"
            accessibilityLabel={status}
            style={props.styles.headerStatusRow}
          >
            <View
              style={[
                props.styles.headerStatusDot,
                props.isConversationBusy ? props.styles.headerStatusDotBusy : null,
              ]}
            />
            <Text style={props.styles.headerStatusText} numberOfLines={1}>
              {status}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={props.styles.headerButton}
          onPress={() => setMenuVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={props.t('chat.openConversationOptions')}
          testID="chat-open-conversation-options"
        >
          <MoreHorizontal size={24} color={props.colors.text} />
        </TouchableOpacity>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setMenuVisible(false)}
        statusBarTranslucent
        transparent
        visible={menuVisible}
      >
        <View style={props.styles.conversationMenuOverlay}>
          <Pressable
            accessibilityLabel={props.t('common.close')}
            accessibilityRole="button"
            onPress={() => setMenuVisible(false)}
            style={StyleSheet.absoluteFill}
            testID="chat-conversation-options-backdrop"
          />
          <SafeAreaView
            accessibilityViewIsModal
            edges={['bottom']}
            style={props.styles.conversationMenuSheet}
          >
            <View>
              <View style={props.styles.conversationMenuHandle} />
              <View style={props.styles.conversationMenuHeader}>
                <Text style={props.styles.conversationMenuTitle}>
                  {props.t('chat.conversationOptions')}
                </Text>
                <TouchableOpacity
                  accessibilityLabel={props.t('common.close')}
                  accessibilityRole="button"
                  onPress={() => setMenuVisible(false)}
                  style={props.styles.conversationMenuClose}
                  testID="chat-close-conversation-options"
                >
                  <X size={22} color={props.colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {props.activeConversation ? (
                <>
                  <ConversationMenuRow
                    Icon={Settings2}
                    label={props.t('chat.conversationSettings')}
                    onPress={() => runAndClose(props.onOpenConversationSettings)}
                    props={props}
                    testID="chat-open-conversation-settings"
                  />
                  <ConversationMenuRow
                    Icon={FolderOpen}
                    label={props.t('nav.filesAndCreations')}
                    onPress={() => runAndClose(props.onOpenFiles)}
                    props={props}
                    testID="chat-open-files"
                  />
                  <ConversationMenuRow
                    Icon={BarChart3}
                    label={props.t('chat.usageActivity')}
                    onPress={() => runAndClose(props.onOpenUsage)}
                    props={props}
                    testID="chat-open-usage"
                  />
                  <ConversationMenuRow
                    Icon={props.activeConversation.isSideThread ? Trash2 : GitBranch}
                    danger={props.activeConversation.isSideThread}
                    label={
                      props.activeConversation.isSideThread
                        ? props.t('chat.discardSideThread')
                        : props.t('chat.startSideThread')
                    }
                    onPress={() => runAndClose(props.onToggleSideThread)}
                    props={props}
                    testID={
                      props.activeConversation.isSideThread
                        ? 'chat-discard-side-thread'
                        : 'chat-start-side-thread'
                    }
                  />
                  <View style={props.styles.conversationMenuDivider} />
                </>
              ) : null}

              <ConversationMenuRow
                Icon={SquareTerminal}
                label={props.t('nav.developerAndRemoteWork')}
                onPress={() => runAndClose(props.onOpenDeveloperTools)}
                props={props}
                testID="chat-open-developer-tools"
              />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
