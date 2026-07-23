// ---------------------------------------------------------------------------
// Kavi — Sidebar (Assistant-first navigation)
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import {
  Plus,
  Settings,
  Sparkles,
  ListChecks,
  Library,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react-native';
import { TodaysFocusTile } from './SidebarMemorySections';
import { SidebarRecentChats } from './SidebarRecentChats';
import MigrationProgressBanner from '../MigrationProgressBanner';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { SafeAreaView } from 'react-native-safe-area-context';
import { resolveConversationStartSelection } from '../../services/llm/support/providerSupport';

export const Sidebar: React.FC<DrawerContentComponentProps> = ({ navigation, state }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const getOrCreateCanonicalThread = useChatStore((s) => s.getOrCreateCanonicalThread);
  const createSideThread = useChatStore((s) => s.createSideThread);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const providers = useSettingsStore((s) => s.providers);
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const activeModel = useSettingsStore((s) => s.activeModel);
  const currentRoute = state.routes[state.index];
  const currentRouteName = currentRoute?.name;
  const currentAgentRosterTab =
    currentRouteName === 'AgentRoster' &&
    typeof currentRoute.params === 'object' &&
    currentRoute.params !== null &&
    'initialTab' in currentRoute.params
      ? currentRoute.params.initialTab
      : undefined;
  const groupedRoutes: Array<{
    name: 'Activity' | 'Library' | 'More';
    label: string;
    icon: LucideIcon;
    children: string[];
  }> = [
    {
      name: 'Activity',
      label: t('nav.activity'),
      icon: ListChecks,
      children: ['Activity', 'Scheduler', 'ApprovalHistory'],
    },
    {
      name: 'Library',
      label: t('nav.library'),
      icon: Library,
      children: ['Library', 'Memory', 'Canvas', 'ConversationFiles'],
    },
    {
      name: 'More',
      label: t('nav.more'),
      icon: MoreHorizontal,
      children: [
        'More',
        'DeveloperWork',
        'Voice',
        'McpStatus',
        'Skills',
        'Gateway',
        'RemoteWork',
        'Terminal',
        'CodeEditor',
        'BrowserSession',
      ],
    },
  ];

  const handleNew = () => {
    const selection = resolveConversationStartSelection(providers, activeProviderId, activeModel);
    if (!selection) {
      Alert.alert(t('common.error'), t('chat.noProvider'));
      navigation.navigate('Settings');
      navigation.closeDrawer();
      return;
    }

    // Side-thread sandbox branches off the canonical main thread.
    let parentId: string | null = activeId;
    if (!parentId) {
      parentId = getOrCreateCanonicalThread(
        selection.providerId,
        systemPrompt,
        selection.model || undefined,
      );
    } else {
      const current = conversations.find((c) => c.id === parentId);
      if (current?.isSideThread) {
        parentId = current.parentConversationId ?? parentId;
      }
    }

    if (typeof createSideThread === 'function' && parentId) {
      const sideId = createSideThread(parentId, {
        providerId: selection.providerId,
        modelOverride: selection.model || undefined,
      });
      if (sideId) {
        navigation.navigate('Chat');
        navigation.closeDrawer();
        return;
      }
    }

    getOrCreateCanonicalThread(selection.providerId, systemPrompt, selection.model || undefined);
    navigation.navigate('Chat');
    navigation.closeDrawer();
  };

  const handleOpenChat = useCallback(() => {
    navigation.navigate('Chat');
    navigation.closeDrawer();
  }, [navigation]);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      if (!conversations.some((conversation) => conversation.id === conversationId)) {
        return;
      }
      setActiveConversation(conversationId);
      navigation.navigate('Chat');
      navigation.closeDrawer();
    },
    [conversations, navigation, setActiveConversation],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('common.appName')}</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={handleNew}
          accessibilityRole="button"
          accessibilityLabel={t('nav.newChat')}
          testID="sidebar-new-chat"
        >
          <Plus size={22} color={colors.onPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ selected: currentRouteName === 'Chat' }}
          onPress={handleOpenChat}
          style={[
            styles.assistantBtn,
            currentRouteName === 'Chat' ? styles.assistantBtnActive : null,
          ]}
          testID="sidebar-assistant"
        >
          <Sparkles
            size={20}
            color={currentRouteName === 'Chat' ? colors.primary : colors.textSecondary}
          />
          <Text
            style={[
              styles.assistantText,
              currentRouteName === 'Chat' ? styles.assistantTextActive : null,
            ]}
          >
            {t('nav.assistant')}
          </Text>
        </TouchableOpacity>
        <TodaysFocusTile colors={colors} conversationId={activeId} onPress={handleOpenChat} />
        <SidebarRecentChats
          activeConversationId={activeId}
          colors={colors}
          conversations={conversations}
          onSeeAll={() => {
            navigation.navigate('Chats');
            navigation.closeDrawer();
          }}
          onSelect={handleSelectConversation}
        />
        <MigrationProgressBanner colors={colors} />
        <View style={styles.destinationGroup}>
          {groupedRoutes.map((route) => {
            const active = currentRouteName
              ? route.children.includes(currentRouteName) ||
                (currentRouteName === 'AgentRoster' &&
                  ((route.name === 'Activity' && currentAgentRosterTab === 'queue') ||
                    (route.name === 'More' && currentAgentRosterTab !== 'queue')))
              : false;
            const Icon = route.icon;
            return (
              <TouchableOpacity
                key={route.name}
                accessibilityLabel={route.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  navigation.navigate(route.name);
                  navigation.closeDrawer();
                }}
                style={[styles.destinationBtn, active ? styles.destinationBtnActive : null]}
                testID={`sidebar-${route.name.toLowerCase()}`}
              >
                <Icon size={20} color={active ? colors.primary : colors.textSecondary} />
                <Text
                  style={[styles.destinationText, active ? styles.destinationTextActive : null]}
                >
                  {route.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Settings');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.settings')}
      >
        <Settings size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.settings')}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.panel,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    newBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingBottom: 8,
    },
    assistantBtn: {
      minHeight: 52,
      marginHorizontal: 8,
      marginVertical: 8,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 12,
    },
    assistantBtnActive: {
      backgroundColor: colors.primarySoft,
    },
    assistantText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    assistantTextActive: {
      color: colors.primary,
    },
    settingsBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    settingsText: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    destinationGroup: {
      marginTop: 8,
      paddingTop: 8,
      paddingHorizontal: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    destinationBtn: {
      minHeight: 52,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 12,
    },
    destinationBtnActive: {
      backgroundColor: colors.primarySoft,
    },
    destinationText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    destinationTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
  });
