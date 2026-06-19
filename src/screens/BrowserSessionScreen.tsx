// ---------------------------------------------------------------------------
// Kavi — Browser Session Screen (Live Supervision)
// ---------------------------------------------------------------------------
// Shows live browser session status, screenshot polling, action timeline,
// and quick-action palette for remote browser automation sessions.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import {
  Menu,
  Globe,
  Camera,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Monitor,
  MousePointer,
  Type as TypeIcon,
  ArrowUp,
  Eye,
} from 'lucide-react-native';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import { useRemoteStore } from '../services/remote/store';
import { useBrowserTraceStore, type BrowserTraceEntry } from '../services/browser/traceStore';
import type { RemoteSessionRecord } from '../types/remote';
import { useSettingsStore } from '../store/useSettingsStore';
import { getBrowserProviderReadiness } from '../services/browser/providers/readiness';

// ── Component ────────────────────────────────────────────────────────────

const EMPTY_TRACES: BrowserTraceEntry[] = [];

export const BrowserSessionScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const sessions = useRemoteStore((s) => s.sessions);
  const browserProviders = useSettingsStore((s) => s.browserProviders);
  const browserConfig = browserProviders?.[0];
  const providerReady = browserConfig ? getBrowserProviderReadiness(browserConfig) : null;

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const screenshotRequestIdRef = useRef(0);

  // Get browser sessions sorted by last activity
  const browserSessions = useMemo(() => {
    return Object.values(sessions)
      .filter((s: RemoteSessionRecord) => s.kind === 'browser-live')
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [sessions]);

  const selectedSession = selectedSessionId ? sessions[selectedSessionId] : undefined;
  const activeSession =
    selectedSession?.kind === 'browser-live' ? selectedSession : browserSessions[0];
  const activeSessionId = activeSession?.id || '';
  const activeSessionStatus = activeSession?.status;
  const activeSessionLiveViewUrl = activeSession?.liveViewUrl;

  // Real action timeline from browser trace store
  const actionTraces = useBrowserTraceStore((s) => s.traces[activeSessionId]) || EMPTY_TRACES;

  const clearScreenshotPolling = useCallback(() => {
    if (!pollRef.current) {
      return;
    }

    clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const loadScreenshot = useCallback(
    async (sessionId: string, options?: { clearOnEmpty?: boolean }) => {
      const requestId = screenshotRequestIdRef.current + 1;
      screenshotRequestIdRef.current = requestId;

      if (isMountedRef.current) {
        setScreenshotLoading(true);
      }

      try {
        const { takeScreenshot } = require('../services/browser/jobs');
        const uri = await takeScreenshot(sessionId);
        if (requestId !== screenshotRequestIdRef.current || !isMountedRef.current) {
          return;
        }

        if (uri) {
          setScreenshotUri(uri);
        } else if (options?.clearOnEmpty) {
          setScreenshotUri(null);
        }
      } catch {
        if (requestId !== screenshotRequestIdRef.current || !isMountedRef.current) {
          return;
        }

        if (options?.clearOnEmpty) {
          setScreenshotUri(null);
        }
      } finally {
        if (requestId === screenshotRequestIdRef.current && isMountedRef.current) {
          setScreenshotLoading(false);
        }
      }
    },
    [],
  );

  // Screenshot polling
  useEffect(() => {
    clearScreenshotPolling();
    screenshotRequestIdRef.current += 1;

    if (!activeSessionId || activeSessionStatus !== 'connected') {
      setScreenshotUri(null);
      setScreenshotLoading(false);
      return;
    }

    setScreenshotUri(null);
    void loadScreenshot(activeSessionId, { clearOnEmpty: true });
    pollRef.current = setInterval(() => {
      void loadScreenshot(activeSessionId);
    }, 5000);
    (pollRef.current as any)?.unref?.();

    return () => {
      clearScreenshotPolling();
      screenshotRequestIdRef.current += 1;
    };
  }, [activeSessionId, activeSessionStatus, clearScreenshotPolling, loadScreenshot]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      screenshotRequestIdRef.current += 1;
      clearScreenshotPolling();
    };
  }, [clearScreenshotPolling]);

  const handleRefreshScreenshot = useCallback(async () => {
    if (!activeSessionId || activeSessionStatus !== 'connected') {
      return;
    }

    await loadScreenshot(activeSessionId);
  }, [activeSessionId, activeSessionStatus, loadScreenshot]);

  const handleOpenLiveView = useCallback(() => {
    if (!activeSessionLiveViewUrl) {
      return;
    }

    Linking.openURL(activeSessionLiveViewUrl).catch(() => {
      // ignore deep-link failures; the live view is optional
    });
  }, [activeSessionLiveViewUrl]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'connected':
        return t('browserSessions.statusConnected');
      case 'error':
        return t('browserSessions.statusError');
      case 'closed':
        return t('browserSessions.statusClosed');
      default:
        return t('browserSessions.statusConnecting');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return colors.success;
      case 'error':
        return colors.danger;
      case 'closed':
        return colors.textTertiary;
      default:
        return colors.warning;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <CheckCircle2 size={14} color={colors.success} />;
      case 'error':
        return <AlertTriangle size={14} color={colors.danger} />;
      default:
        return <Clock size={14} color={colors.textTertiary} />;
    }
  };

  // ── No provider configured ──────────────────────────────────────────

  if (!providerReady?.launchable) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} hitSlop={8}>
            <Menu size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('browserSessions.title')}</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <Globe size={48} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>{t('browserSessions.noProviderTitle')}</Text>
          <Text style={styles.emptySubtext}>{t('browserSessions.noProviderDescription')}</Text>
          <TouchableOpacity
            style={styles.configBtn}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.configBtnText}>{t('browserSessions.openSettings')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── No sessions ─────────────────────────────────────────────────────

  if (browserSessions.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} hitSlop={8}>
            <Menu size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('browserSessions.title')}</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <Monitor size={48} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>{t('browserSessions.emptyTitle')}</Text>
          <Text style={styles.emptySubtext}>{t('browserSessions.emptyDescription')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.openDrawer()} hitSlop={8}>
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('browserSessions.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Session tabs */}
      {browserSessions.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {browserSessions.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.tab, s.id === activeSession?.id && styles.tabActive]}
              onPress={() => setSelectedSessionId(s.id)}
            >
              {getStatusIcon(s.status)}
              <Text
                style={[styles.tabText, s.id === activeSession?.id && styles.tabTextActive]}
                numberOfLines={1}
              >
                {s.summary || s.externalId?.slice(0, 8) || t('browserSessions.sessionFallback')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {activeSession && (
          <>
            {/* Session info bar */}
            <View style={styles.infoBar}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: getStatusColor(activeSession.status) },
                ]}
              />
              <Text style={styles.infoLabel}>{getStatusLabel(activeSession.status)}</Text>
              <Text style={styles.infoDivider}>•</Text>
              <Text style={styles.infoLabel}>
                {activeSession.providerId || t('browserSessions.providerFallback')}
              </Text>
              <Text style={styles.infoDivider}>•</Text>
              <Text style={styles.infoLabel}>
                {t('browserSessions.startedAt', { time: formatTime(activeSession.startedAt) })}
              </Text>
            </View>

            {/* Screenshot viewport */}
            <View style={styles.viewport}>
              {screenshotUri ? (
                <Image
                  source={{ uri: screenshotUri }}
                  style={styles.screenshot}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.screenshotPlaceholder}>
                  {screenshotLoading ? (
                    <ActivityIndicator size="large" color={colors.primary} />
                  ) : (
                    <>
                      <Camera size={32} color={colors.textTertiary} />
                      <Text style={styles.placeholderText}>
                        {t('browserSessions.noScreenshot')}
                      </Text>
                    </>
                  )}
                </View>
              )}
              {/* Screenshot toolbar */}
              <View style={styles.screenshotToolbar}>
                <TouchableOpacity
                  style={styles.toolbarBtn}
                  onPress={handleRefreshScreenshot}
                  disabled={screenshotLoading}
                >
                  <RefreshCw
                    size={16}
                    color={screenshotLoading ? colors.textTertiary : colors.primary}
                  />
                  <Text style={styles.toolbarBtnText}>{t('common.refresh')}</Text>
                </TouchableOpacity>
                {activeSession.liveViewUrl && (
                  <TouchableOpacity style={styles.toolbarBtn} onPress={handleOpenLiveView}>
                    <ExternalLink size={16} color={colors.primary} />
                    <Text style={styles.toolbarBtnText}>{t('browserSessions.liveView')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Quick actions palette */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('browserSessions.quickActions')}</Text>
              <View style={styles.actionsGrid}>
                {[
                  {
                    icon: <Eye size={18} color={colors.primary} />,
                    label: t('browserSessions.actionSnapshot'),
                  },
                  {
                    icon: <Camera size={18} color={colors.primary} />,
                    label: t('browserSessions.actionScreenshot'),
                  },
                  {
                    icon: <MousePointer size={18} color={colors.primary} />,
                    label: t('browserSessions.actionClick'),
                  },
                  {
                    icon: <TypeIcon size={18} color={colors.primary} />,
                    label: t('browserSessions.actionType'),
                  },
                  {
                    icon: <ArrowUp size={18} color={colors.primary} />,
                    label: t('browserSessions.actionScroll'),
                  },
                  {
                    icon: <RefreshCw size={18} color={colors.primary} />,
                    label: t('browserSessions.actionReload'),
                  },
                ].map((action) => (
                  <View key={action.label} style={styles.actionCard}>
                    {action.icon}
                    <Text style={styles.actionLabel}>{action.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Action timeline — real traces from browser trace store */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('browserSessions.actionHistory')}</Text>
              {actionTraces.length === 0 ? (
                <Text style={styles.emptyActionText}>{t('browserSessions.noActions')}</Text>
              ) : (
                actionTraces.slice(0, 50).map((trace: BrowserTraceEntry) => (
                  <View key={trace.id} style={styles.timelineItem}>
                    <View
                      style={[
                        styles.timelineDot,
                        trace.status === 'error' && { backgroundColor: colors.danger },
                        trace.status === 'pending' && { backgroundColor: colors.warning },
                      ]}
                    />
                    <View style={styles.timelineContent}>
                      <View style={styles.timelineHeader}>
                        <Text style={styles.timelineKind}>{trace.action}</Text>
                        {trace.durationMs != null && (
                          <Text style={styles.timelineDuration}>
                            {t('common.millisecondsShort', { count: trace.durationMs })}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.timelineDesc} numberOfLines={2}>
                        {trace.description}
                      </Text>
                      {trace.pageUrl && (
                        <Text style={styles.timelineUrl} numberOfLines={1}>
                          {trace.pageUrl}
                        </Text>
                      )}
                      {trace.error && (
                        <Text style={styles.timelineError} numberOfLines={2}>
                          {trace.error}
                        </Text>
                      )}
                      <Text style={styles.timelineTime}>{formatTime(trace.timestamp)}</Text>
                    </View>
                    {trace.status === 'error' && <AlertTriangle size={14} color={colors.danger} />}
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    tabBar: {
      maxHeight: 44,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    tabText: { fontSize: 13, color: colors.textSecondary },
    tabTextActive: { color: colors.primary, fontWeight: '600' },
    content: { padding: 16, gap: 16 },
    infoBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    infoLabel: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize' },
    infoDivider: { fontSize: 12, color: colors.textTertiary },
    viewport: {
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    screenshot: { width: '100%', height: 250 },
    screenshotPlaceholder: {
      width: '100%',
      height: 200,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    placeholderText: { fontSize: 13, color: colors.textTertiary },
    screenshotToolbar: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    toolbarBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    toolbarBtnText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
    section: { gap: 10 },
    sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
    actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    actionCard: {
      width: 80,
      height: 64,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
    },
    actionLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
    emptyActionText: { fontSize: 13, color: colors.textTertiary, fontStyle: 'italic' },
    timelineItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 6,
    },
    timelineDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
      marginTop: 4,
    },
    timelineContent: { flex: 1 },
    timelineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    timelineKind: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      textTransform: 'capitalize',
    },
    timelineDuration: { fontSize: 11, color: colors.textTertiary, fontFamily: 'monospace' },
    timelineDesc: { fontSize: 12, color: colors.textSecondary },
    timelineUrl: { fontSize: 11, color: colors.primary, marginTop: 1 },
    timelineError: { fontSize: 11, color: colors.danger, marginTop: 1 },
    timelineTime: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
      gap: 12,
    },
    emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    emptySubtext: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    configBtn: {
      marginTop: 12,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    configBtnText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  });
