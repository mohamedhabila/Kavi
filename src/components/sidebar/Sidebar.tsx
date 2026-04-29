// ---------------------------------------------------------------------------
// Kavi — Sidebar (Conversation List)
// ---------------------------------------------------------------------------

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Alert } from 'react-native';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import {
  MoreVertical,
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
  Archive,
  ChevronDown,
  ChevronRight,
} from 'lucide-react-native';
import {
  TodaysFocusTile,
  OpenThreadsChips,
  RecallSearchInput,
  PinnedMoments,
  bucketConversationsByTime,
  type TimeBucket,
} from './SidebarMemorySections';
import MigrationProgressBanner from '../MigrationProgressBanner';
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
  const getOrCreateCanonicalThread = useChatStore((s) => s.getOrCreateCanonicalThread);
  const createSideThread = useChatStore((s) => s.createSideThread);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  // Phase 161 §4.8 — Chunk L: collapsible time buckets. Default expanded so the
  // user lands on the same conversation list they had before the IA refactor.
  const [timeBucketCollapsed, setTimeBucketCollapsed] = useState<
    Record<TimeBucket, boolean>
  >({ today: false, yesterday: false, thisWeek: false, earlier: false });

  // Phase 161 §4.5: hide ephemeral side threads from the main sidebar list.
  // Phase 161 §4.1/§5: archived-from-migration conversations are hidden from
  // the main list and surfaced under a collapsed "Archived" section below.
  // The sidebar shows only canonical (or pre-migration) main-thread chats.
  const visibleConversations = useMemo(
    () => conversations.filter((c) => !c.isSideThread && !c.archivedFromMigration),
    [conversations],
  );
  const archivedConversations = useMemo(
    () => conversations.filter((c) => !c.isSideThread && c.archivedFromMigration),
    [conversations],
  );
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

    // Phase 161 §4.8: side-thread sandbox lives in an overflow menu, not a
    // primary "+" button. We branch off the active main thread; if no active
    // conversation exists yet, materialise the canonical one first so the side
    // thread always has a valid parent.
    let parentId: string | null = activeId;
    if (!parentId) {
      if (typeof getOrCreateCanonicalThread === 'function') {
        parentId = getOrCreateCanonicalThread(
          selection.providerId,
          systemPrompt,
          selection.model || undefined,
        );
      } else {
        parentId = createConversation(
          selection.providerId,
          systemPrompt,
          selection.model || undefined,
        );
      }
    } else {
      // Avoid nesting: if we're already inside a side thread, branch off its parent.
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

    // Fallback (older test stores): preserve legacy canonical-thread behaviour
    // so we never strand the user when the side-thread API is unavailable.
    if (typeof getOrCreateCanonicalThread === 'function') {
      getOrCreateCanonicalThread(
        selection.providerId,
        systemPrompt,
        selection.model || undefined,
      );
    } else {
      createConversation(selection.providerId, systemPrompt, selection.model || undefined);
    }
    navigation.closeDrawer();
  };

  const handleOpenThreadOptions = () => {
    Alert.alert(t('nav.threadOptions'), t('nav.startSideThreadHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('nav.startSideThread'), onPress: handleNew },
    ]);
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

  const buckets = useMemo(
    () => bucketConversationsByTime(visibleConversations),
    [visibleConversations],
  );

  const toggleTimeBucket = useCallback((bucket: TimeBucket) => {
    setTimeBucketCollapsed((prev) => ({ ...prev, [bucket]: !prev[bucket] }));
  }, []);

  const handleOpenMemory = useCallback(
    (_query?: string) => {
      navigation.navigate('Memory');
      navigation.closeDrawer();
    },
    [navigation],
  );

  const handleOpenChat = useCallback(() => {
    navigation.navigate('Chat');
    navigation.closeDrawer();
  }, [navigation]);

  const renderConversationRow = (item: Conversation) => {
    const isActive = item.id === activeId;
    return (
      <TouchableOpacity
        key={item.id}
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
  };

  const renderTimeBucket = (bucket: TimeBucket, items: Conversation[], labelKey: string) => {
    if (items.length === 0) return null;
    const collapsed = timeBucketCollapsed[bucket];
    return (
      <View key={bucket} testID={`sidebar-time-bucket-${bucket}`}>
        <TouchableOpacity
          style={styles.bucketHeader}
          onPress={() => toggleTimeBucket(bucket)}
          accessibilityRole="button"
          accessibilityLabel={t(labelKey)}
          accessibilityState={{ expanded: !collapsed }}
          testID={`sidebar-time-bucket-toggle-${bucket}`}
        >
          {collapsed ? (
            <ChevronRight size={12} color={colors.textSecondary} />
          ) : (
            <ChevronDown size={12} color={colors.textSecondary} />
          )}
          <Text style={styles.bucketHeaderText}>
            {`${t(labelKey)} (${items.length})`}
          </Text>
        </TouchableOpacity>
        {!collapsed && items.map((item) => renderConversationRow(item))}
      </View>
    );
  };

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

        <View testID="sidebar-time-buckets">
          {visibleConversations.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('nav.noConversations')}</Text>
              <Text style={styles.emptySubtext}>{t('nav.noConversationsHint')}</Text>
            </View>
          ) : (
            <>
              {renderTimeBucket('today', buckets.today, 'nav.byTimeToday')}
              {renderTimeBucket('yesterday', buckets.yesterday, 'nav.byTimeYesterday')}
              {renderTimeBucket('thisWeek', buckets.thisWeek, 'nav.byTimeThisWeek')}
              {renderTimeBucket('earlier', buckets.earlier, 'nav.byTimeEarlier')}
            </>
          )}
        </View>
      </ScrollView>

      {archivedConversations.length > 0 && (
        <View testID="sidebar-archived-section">
          <TouchableOpacity
            style={styles.archivedHeader}
            onPress={() => setArchivedExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t('nav.archivedSectionLabel', {
              count: archivedConversations.length,
            })}
            accessibilityState={{ expanded: archivedExpanded }}
            testID="sidebar-archived-toggle"
          >
            {archivedExpanded ? (
              <ChevronDown size={14} color={colors.textSecondary} />
            ) : (
              <ChevronRight size={14} color={colors.textSecondary} />
            )}
            <Archive size={14} color={colors.textSecondary} />
            <Text style={styles.archivedHeaderText}>
              {t('nav.archivedSectionLabel', { count: archivedConversations.length })}
            </Text>
          </TouchableOpacity>
          {archivedExpanded && (
            <View testID="sidebar-archived-list">
              {archivedConversations.map((item) => {
                const isActive = item.id === activeId;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.item, isActive && styles.itemActive]}
                    onPress={() => handleSelect(item.id)}
                    onLongPress={() => handleDelete(item.id, item.title)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}, ${formatDate(item.updatedAt)}, ${buildUsageSummary(item)}`}
                    accessibilityHint={t('common.longPressToDelete')}
                    testID={`sidebar-archived-item-${item.id}`}
                  >
                    <Archive
                      size={16}
                      color={isActive ? colors.primary : colors.textSecondary}
                    />
                    <View style={styles.itemContent}>
                      <Text
                        style={[styles.itemTitle, isActive && styles.itemTitleActive]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text style={styles.itemDate}>{formatDate(item.updatedAt)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}

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
