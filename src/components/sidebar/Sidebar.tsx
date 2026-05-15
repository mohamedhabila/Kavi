// ---------------------------------------------------------------------------
// Kavi — Sidebar (Memory-First Navigation)
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import {
  MoreVertical,
  Settings,
  Clock,
  Server,
  Puzzle,
  Layers,
  Mic,
  Radio,
  Brain,
  Monitor,
  Terminal,
  FileCode,
  Globe,
  Users,
} from 'lucide-react-native';
import {
  TodaysFocusTile,
  OpenThreadsChips,
  RecallSearchInput,
  PinnedMoments,
} from './SidebarMemorySections';
import MigrationProgressBanner from '../MigrationProgressBanner';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import { SafeAreaView } from 'react-native-safe-area-context';
import { resolveConversationStartSelection } from '../../services/llm/providerSupport';

export const Sidebar: React.FC<DrawerContentComponentProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const getOrCreateCanonicalThread = useChatStore((s) => s.getOrCreateCanonicalThread);
  const createSideThread = useChatStore((s) => s.createSideThread);
  const providers = useSettingsStore((s) => s.providers);
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const activeModel = useSettingsStore((s) => s.activeModel);

  const handleNew = () => {
    const selection = resolveConversationStartSelection(providers, activeProviderId, activeModel);
    if (!selection) {
      Alert.alert(t('common.error'), t('chat.noProvider'));
      navigation.navigate('Settings');
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
    navigation.closeDrawer();
  };

  const handleOpenThreadOptions = () => {
    Alert.alert(t('nav.threadOptions'), t('nav.startSideThreadHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('nav.startSideThread'), onPress: handleNew },
    ]);
  };

  const handleOpenMemory = useCallback(
    (query?: string) => {
      navigation.navigate('Memory', query ? { tab: 'facts', query } : { tab: 'facts' });
      navigation.closeDrawer();
    },
    [navigation],
  );

  const handleOpenChat = useCallback(() => {
    navigation.navigate('Chat');
    navigation.closeDrawer();
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('common.appName')}</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={handleOpenThreadOptions}
          accessibilityRole="button"
          accessibilityLabel={t('nav.threadOptions')}
          testID="sidebar-thread-options"
        >
          <MoreVertical size={20} color={colors.onPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        <MigrationProgressBanner colors={colors} />
        <TodaysFocusTile colors={colors} onPress={handleOpenChat} />
        <OpenThreadsChips colors={colors} onSelect={handleOpenChat} />
        <RecallSearchInput colors={colors} onSubmit={handleOpenMemory} />
        <PinnedMoments colors={colors} onSelect={() => handleOpenMemory()} />
      </ScrollView>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Scheduler');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.scheduler')}
      >
        <Clock size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.scheduler')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('McpStatus');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.mcpStatus')}
      >
        <Server size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.mcpStatus')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Skills');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.skills')}
      >
        <Puzzle size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.skills')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Memory');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.memory')}
      >
        <Brain size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.memory')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Canvas');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.canvas')}
      >
        <Layers size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.canvas')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Voice');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.voice')}
      >
        <Mic size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.voice')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Gateway');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.gateway')}
      >
        <Radio size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.gateway')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('Terminal');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.terminal')}
      >
        <Terminal size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.terminal')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('CodeEditor');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.codeEditor')}
      >
        <FileCode size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.codeEditor')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('BrowserSession');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.browserSessions')}
      >
        <Globe size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.browserSessions')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('AgentRoster');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.agentRoster')}
      >
        <Users size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.agentRoster')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => {
          navigation.navigate('RemoteWork');
          navigation.closeDrawer();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('nav.remoteWork')}
      >
        <Monitor size={20} color={colors.textSecondary} />
        <Text style={styles.settingsText}>{t('nav.remoteWork')}</Text>
      </TouchableOpacity>

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
      width: 36,
      height: 36,
      borderRadius: 18,
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
    bucketHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 4,
    },
    bucketHeaderText: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 8,
      marginHorizontal: 8,
      marginVertical: 2,
    },
    itemActive: {
      backgroundColor: colors.primarySoft,
    },
    itemContent: {
      flex: 1,
    },
    itemTitle: {
      fontSize: 14,
      color: colors.text,
    },
    itemTitleActive: {
      fontWeight: '600',
      color: colors.primary,
    },
    itemDate: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 2,
    },
    itemUsage: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    empty: {
      padding: 40,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    emptySubtext: {
      fontSize: 13,
      color: colors.textTertiary,
      marginTop: 4,
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
    archivedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    archivedHeaderText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
  });
