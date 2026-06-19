import { CheckCircle2 } from 'lucide-react-native';
import React from 'react';
import { Text, View } from 'react-native';

import type { AppPalette } from '../../theme/useAppTheme';
import type { RemoteJobRecord } from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type StyleMap = Record<string, any>;

type RemoteWorkJobsSectionProps = {
  colors: AppPalette;
  styles: StyleMap;
  t: TranslationFn;
  trackedRemoteJobs: RemoteJobRecord[];
};

export const RemoteWorkJobsSection: React.FC<RemoteWorkJobsSectionProps> = ({
  colors,
  styles,
  t,
  trackedRemoteJobs,
}) => {
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('remoteWork.jobsTitle')}</Text>
        <Text style={styles.sectionCaption}>
          {String(trackedRemoteJobs.filter((job) => job.status === 'running').length)}
        </Text>
      </View>

      {trackedRemoteJobs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t('remoteWork.noJobsTitle')}</Text>
          <Text style={styles.emptyText}>{t('remoteWork.noJobsHint')}</Text>
        </View>
      ) : (
        trackedRemoteJobs.map((job) => (
          <View key={job.id} style={styles.targetCard}>
            <View style={styles.targetHeader}>
              <View style={styles.targetHeaderText}>
                <Text style={styles.targetTitle}>{job.summary}</Text>
                <Text style={styles.targetSubtitle}>{job.executionSurface}</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  job.status === 'completed' ? styles.badgeReady : styles.badgeWarn,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    job.status === 'completed' ? styles.badgeTextReady : styles.badgeTextWarn,
                  ]}
                >
                  {job.status}
                </Text>
              </View>
            </View>
            {job.progressText ? <Text style={styles.detailValue}>{job.progressText}</Text> : null}
            {job.error ? <Text style={styles.sessionError}>{job.error}</Text> : null}
            {job.artifacts.map((artifact) => (
              <View key={artifact.id} style={styles.probeRow}>
                <CheckCircle2 size={14} color={colors.textSecondary} />
                <Text style={styles.probeText}>
                  {artifact.uri || artifact.value || artifact.title}
                </Text>
              </View>
            ))}
          </View>
        ))
      )}
    </>
  );
};
