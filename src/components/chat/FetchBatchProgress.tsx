import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import type { AppPalette } from '../../theme/useAppTheme';
import {
  summarizeFetchBatch,
  type FetchBatchTarget,
} from './fetchBatchGrouping';

/**
 * One row for a run of page fetches, in place of a card per URL.
 *
 * A research turn issues a dozen or more fetches. Rendered individually they crowd out
 * everything else in the transcript while showing the reader the least useful thing —
 * that a page is being fetched — instead of which pages, and how far along. This shows
 * the hosts and the progress, and keeps the per-call detail one tap away.
 */

type Props = {
  targets: ReadonlyArray<FetchBatchTarget>;
  children: React.ReactNode;
};

function faviconUri(host: string): string {
  return `https://${host}/favicon.ico`;
}

const HostIcon: React.FC<{ host: string; colors: AppPalette }> = ({ host, colors }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View
        style={[styles.faviconFallback, { backgroundColor: colors.border }]}
        accessibilityElementsHidden
      >
        <Text style={[styles.faviconInitial, { color: colors.textSecondary }]}>
          {host.slice(0, 1).toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: faviconUri(host) }}
      style={styles.favicon}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
};

export const FetchBatchProgress: React.FC<Props> = ({ targets, children }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const progress = summarizeFetchBatch(targets);

  const label = progress.active
    ? t('chat.fetchBatchReading', {
        settled: String(progress.settled),
        total: String(progress.total),
      })
    : t('chat.fetchBatchRead', { total: String(progress.total) });

  const hosts = targets
    .map((target) => target.host)
    .filter((host): host is string => Boolean(host));
  const uniqueHosts = Array.from(new Set(hosts));
  const shownHosts = uniqueHosts.slice(0, 4);
  const overflow = uniqueHosts.length - shownHosts.length;

  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
        style={styles.header}
      >
        {progress.active ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <View style={[styles.doneDot, { backgroundColor: colors.primary }]} />
        )}
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {label}
          </Text>
          {shownHosts.length > 0 ? (
            <View style={styles.hostRow}>
              {shownHosts.map((host) => (
                <View key={host} style={styles.hostChip}>
                  <HostIcon host={host} colors={colors} />
                  <Text style={[styles.hostText, { color: colors.textSecondary }]} numberOfLines={1}>
                    {host}
                  </Text>
                </View>
              ))}
              {overflow > 0 ? (
                <Text style={[styles.hostText, { color: colors.textSecondary }]}>
                  {t('chat.fetchBatchMore', { count: String(overflow) })}
                </Text>
              ) : null}
            </View>
          ) : null}
          {progress.failed > 0 ? (
            <Text style={[styles.failed, { color: colors.textSecondary }]}>
              {t('chat.fetchBatchFailed', { count: String(progress.failed) })}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.chevron, { color: colors.textSecondary }]}>
          {expanded ? '⌄' : '›'}
        </Text>
      </Pressable>
      {expanded ? <View style={styles.details}>{children}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, marginVertical: 4, overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 10, padding: 12 },
  headerText: { flex: 1, gap: 4 },
  title: { fontSize: 14, fontWeight: '600' },
  hostRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hostChip: { alignItems: 'center', flexDirection: 'row', gap: 4, maxWidth: 150 },
  favicon: { borderRadius: 3, height: 14, width: 14 },
  faviconFallback: {
    alignItems: 'center',
    borderRadius: 3,
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  faviconInitial: { fontSize: 9, fontWeight: '700' },
  hostText: { fontSize: 12 },
  failed: { fontSize: 12 },
  doneDot: { borderRadius: 5, height: 10, width: 10 },
  chevron: { fontSize: 16 },
  details: { paddingBottom: 8, paddingHorizontal: 8 },
});
