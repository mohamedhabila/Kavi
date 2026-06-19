import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { RemoteSessionRecord } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkSessionsSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  trackedRemoteSessions: RemoteSessionRecord[];
  setActiveBrowserSession: (session: RemoteSessionRecord | null) => void;
  handleStopBrowser: (session: RemoteSessionRecord) => void | Promise<void>;
};

export const RemoteWorkSessionsSection: React.FC<RemoteWorkSessionsSectionProps> = ({
  styles,
  t,
  trackedRemoteSessions,
  setActiveBrowserSession,
  handleStopBrowser,
}) => {
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('remoteWork.sessionsTitle')}</Text>
        <Text style={styles.sectionCaption}>
          {String(trackedRemoteSessions.filter((session) => session.status !== 'closed').length)}
        </Text>
      </View>

      {trackedRemoteSessions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t('remoteWork.noSessionsTitle')}</Text>
          <Text style={styles.emptyText}>{t('remoteWork.noSessionsHint')}</Text>
        </View>
      ) : (
        trackedRemoteSessions.map((session) => (
          <View key={session.id} style={styles.targetCard}>
            <View style={styles.targetHeader}>
              <View style={styles.targetHeaderText}>
                <Text style={styles.targetTitle}>{session.summary}</Text>
                <Text style={styles.targetSubtitle}>{session.kind}</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  session.status === 'connected' ? styles.badgeReady : styles.badgeWarn,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    session.status === 'connected' ? styles.badgeTextReady : styles.badgeTextWarn,
                  ]}
                >
                  {session.status}
                </Text>
              </View>
            </View>

            {session.liveViewUrl ? (
              <>
                <Text style={styles.detailLabel}>{t('remoteWork.liveViewUrl')}</Text>
                <Text style={styles.detailValue}>{session.liveViewUrl}</Text>
              </>
            ) : null}

            {session.error ? <Text style={styles.sessionError}>{session.error}</Text> : null}

            {session.kind === 'browser-live' ? (
              <View style={styles.actionRow}>
                {session.liveViewUrl ? (
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => setActiveBrowserSession(session)}
                    accessibilityRole="button"
                    accessibilityLabel={t('remoteWork.openLiveView')}
                  >
                    <Text style={styles.primaryBtnText}>{t('remoteWork.openLiveView')}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => void handleStopBrowser(session)}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.stopBrowserSession')}
                >
                  <Text style={styles.secondaryBtnText}>{t('remoteWork.stopBrowserSession')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))
      )}
    </>
  );
};
