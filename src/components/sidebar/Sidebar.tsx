// ---------------------------------------------------------------------------
// Kavi — Sidebar (Conversation List)
// ---------------------------------------------------------------------------

import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import {
  Plus,
  Trash2,
  Settings,
  MessageSquare,
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
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Conversation } from '../../types';
import { resolveConversationStartSelection } from '../../services/llm/providerSupport';

function formatCompactTokens(value: number): string {
  const absolute = Math.max(0, Math.round(value));
  if (absolute >= 1_000_000) {
    return `${(absolute / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (absolute >= 1_000) {
    return `${(absolute / 1_000).toFixed(absolute >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  }
  return String(absolute);
}

function formatCompactCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }
  if (value < 0.0001) {
    return '<$0.0001';
  }
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function buildUsageSummary(conversation: Conversation): string {
  const totalTokens = conversation.usage?.totalTokens ?? 0;
  const totalCost = conversation.usage?.totalCost ?? 0;
  return `${formatCompactTokens(totalTokens)} tok · ${formatCompactCost(totalCost)}`;
}

export const Sidebar: React.FC<DrawerContentComponentProps> = ({ navigation }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
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

    createConversation(selection.providerId, systemPrompt, selection.model || undefined);
    navigation.closeDrawer();
  };

  const handleSelect = (id: string) => {
    setActiveConversation(id);
    navigation.navigate('Chat');
    navigation.closeDrawer();
  };

  const handleDelete = (id: string, title: string) => {
    Alert.alert(t('nav.deleteChat'), t('nav.deleteChatConfirm', { title }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteConversation(id),
      },
    ]);
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('common.appName')}</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={handleNew}
          accessibilityRole="button"
          accessibilityLabel={t('nav.newConversation')}
        >
          <Plus size={20} color={colors.onPrimary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        style={styles.list}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        initialNumToRender={15}
        windowSize={7}
        renderItem={({ item }) => {
          const isActive = item.id === activeId;
          return (
            <TouchableOpacity
              style={[styles.item, isActive && styles.itemActive]}
              onPress={() => handleSelect(item.id)}
              onLongPress={() => handleDelete(item.id, item.title)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${formatDate(item.updatedAt)}, ${buildUsageSummary(item)}`}
              accessibilityHint={t('common.longPressToDelete')}
            >
              <MessageSquare size={16} color={isActive ? colors.primary : colors.textSecondary} />
              <View style={styles.itemContent}>
                <Text
                  style={[styles.itemTitle, isActive && styles.itemTitleActive]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text style={styles.itemDate}>{formatDate(item.updatedAt)}</Text>
                <Text
                  style={styles.itemUsage}
                  testID={`sidebar-usage-summary-${item.id}`}
                  numberOfLines={1}
                >
                  {buildUsageSummary(item)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('nav.noConversations')}</Text>
            <Text style={styles.emptySubtext}>{t('nav.noConversationsHint')}</Text>
          </View>
        }
      />

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
  });
