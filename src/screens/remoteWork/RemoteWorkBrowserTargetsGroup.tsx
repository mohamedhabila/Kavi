import { CheckCircle2, Play, RefreshCw } from 'lucide-react-native';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { BrowserProviderConfig } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkBrowserTargetsGroupProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  browserProviders: BrowserProviderConfig[];
  trackedRemoteSessions: any[];
  browserProbeResults: Record<string, any>;
  pendingBrowserChecks: Record<string, boolean | undefined>;
  pendingBrowserLaunches: Record<string, boolean | undefined>;
  activeBrowserSession?: any;
  getBrowserProviderReadiness: (provider: BrowserProviderConfig) => { launchable: boolean };
  getBrowserProviderLabel: (provider: BrowserProviderConfig['provider']) => string;
  getBrowserReadinessLabel: (provider: BrowserProviderConfig) => string;
  handleCreateBrowser: () => void;
  handleLaunchBrowser: (provider: BrowserProviderConfig) => void | Promise<void>;
  handleProbeBrowser: (provider: BrowserProviderConfig) => void | Promise<void>;
  handleEditBrowserConfig: (provider: BrowserProviderConfig) => void;
};

export const RemoteWorkBrowserTargetsGroup: React.FC<RemoteWorkBrowserTargetsGroupProps> = ({
  colors,
  styles,
  t,
  browserProviders,
  trackedRemoteSessions,
  browserProbeResults,
  pendingBrowserChecks,
  pendingBrowserLaunches,
  activeBrowserSession,
  getBrowserProviderReadiness,
  getBrowserProviderLabel,
  getBrowserReadinessLabel,
  handleCreateBrowser,
  handleLaunchBrowser,
  handleProbeBrowser,
  handleEditBrowserConfig,
}) => (
  <>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('remoteWork.browserTargetsTitle')}</Text>
      <Text style={styles.sectionCaption}>
        {t('remoteWork.configuredCount', {
          count: browserProviders.filter((provider) => provider.enabled).length,
        })}
      </Text>
    </View>

    {browserProviders.length === 0 ? (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>{t('remoteWork.noBrowserTargetsTitle')}</Text>
        <Text style={styles.emptyText}>{t('remoteWork.noBrowserTargetsHint')}</Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleCreateBrowser}
          accessibilityRole="button"
          accessibilityLabel={t('settings.addBrowserProvider')}
        >
          <Text style={styles.primaryBtnText}>{t('settings.addBrowserProvider')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}

    {browserProviders.map((provider) => {
      const readiness = getBrowserProviderReadiness(provider);
      const probe = browserProbeResults[provider.id];
      const pending = Boolean(pendingBrowserChecks[provider.id]);
      const launching =
        Boolean(pendingBrowserLaunches[provider.id]) ||
        activeBrowserSession?.providerId === provider.id;
      const activeBrowserProviderSession = trackedRemoteSessions.find(
        (session) =>
          session.providerId === provider.id &&
          session.kind === 'browser-live' &&
          session.status !== 'closed',
      );
      return (
        <View key={provider.id} style={styles.targetCard}>
          <View style={styles.targetHeader}>
            <View style={styles.targetHeaderText}>
              <Text style={styles.targetTitle}>{provider.name}</Text>
              <Text style={styles.targetSubtitle}>
                {getBrowserProviderLabel(provider.provider)}
              </Text>
            </View>
            <View
              style={[styles.badge, readiness.launchable ? styles.badgeReady : styles.badgeWarn]}
            >
              <Text
                style={[
                  styles.badgeText,
                  readiness.launchable ? styles.badgeTextReady : styles.badgeTextWarn,
                ]}
              >
                {getBrowserReadinessLabel(provider)}
              </Text>
            </View>
          </View>

          <Text style={styles.detailLabel}>{t('remoteWork.baseUrl')}</Text>
          <Text style={styles.detailValue}>
            {provider.baseUrl?.trim() || t('remoteWork.notConfigured')}
          </Text>

          {provider.projectId ? (
            <>
              <Text style={styles.detailLabel}>{t('remoteWork.browserProjectId')}</Text>
              <Text style={styles.detailValue}>{provider.projectId}</Text>
            </>
          ) : null}

          {probe ? (
            <View style={styles.probeRow}>
              <CheckCircle2
                size={14}
                color={probe.ok ? colors.success || colors.primary : colors.danger}
              />
              <Text
                style={[
                  styles.probeText,
                  { color: probe.ok ? colors.success || colors.primary : colors.danger },
                ]}
              >
                {probe.message}
              </Text>
            </View>
          ) : null}

          {activeBrowserProviderSession ? (
            <Text style={styles.sessionHint}>{activeBrowserProviderSession.summary}</Text>
          ) : null}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, !readiness.launchable && styles.disabledBtn]}
              onPress={() => void handleLaunchBrowser(provider)}
              disabled={!readiness.launchable || launching}
              accessibilityRole="button"
              accessibilityLabel={t('remoteWork.launchBrowserSession')}
            >
              {launching ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Play size={14} color={colors.onPrimary} />
              )}
              <Text style={styles.primaryBtnText}>{t('remoteWork.launchBrowserSession')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => void handleProbeBrowser(provider)}
              accessibilityRole="button"
              accessibilityLabel={t('remoteWork.checkConnection')}
            >
              {pending ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <RefreshCw size={16} color={colors.primary} />
              )}
              <Text style={styles.secondaryBtnText}>
                {pending ? t('remoteWork.checkingConnection') : t('remoteWork.checkConnection')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => handleEditBrowserConfig(provider)}
              accessibilityRole="button"
              accessibilityLabel={t('settings.editBrowserProvider')}
            >
              <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    })}
  </>
);
