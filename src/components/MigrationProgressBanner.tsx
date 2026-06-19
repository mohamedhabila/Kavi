// ---------------------------------------------------------------------------
// Kavi — Migration progress banner
// ---------------------------------------------------------------------------
// Lightweight banner shown in the sidebar while the v6→v7 archived-thread
// memory backfill is still draining. It polls `listMigrationStates()` on a
// slow interval (5s) and disappears once nothing is `pending` / `in_progress`,
// or when the user explicitly dismisses it.
//
// Strings come from `memory.migrationSeed{Title,Progress,Complete}` which are
// already shipped across all 9 locales.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Brain, X } from 'lucide-react-native';
import { useTranslation } from '../i18n/useTranslation';
import { AppPalette } from '../theme/useAppTheme';

function safeListStates(): { pending: number; total: number } {
  try {
    const { listMigrationStates } = require('../services/memory/migrationSeedPass');
    const rows = listMigrationStates();
    let pending = 0;
    let done = 0;
    for (const r of rows) {
      if (r.status === 'completed') done++;
      else if (r.status === 'pending' || r.status === 'in_progress') pending++;
    }
    return { pending, total: pending + done };
  } catch {
    return { pending: 0, total: 0 };
  }
}

interface MigrationProgressBannerProps {
  colors: AppPalette;
  /** Override poll interval for tests. */
  pollIntervalMs?: number;
  /** Test seam for forcing initial state. */
  initialState?: { pending: number; total: number };
}

export const MigrationProgressBanner: React.FC<MigrationProgressBannerProps> = ({
  colors,
  pollIntervalMs = 5000,
  initialState,
}) => {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState(() => initialState ?? safeListStates());

  useEffect(() => {
    if (dismissed) return;
    const tick = () => setState(safeListStates());
    tick();
    const id = setInterval(tick, pollIntervalMs);
    return () => clearInterval(id);
  }, [dismissed, pollIntervalMs]);

  const styles = useMemo(() => createStyles(colors), [colors]);

  if (dismissed) return null;
  if (state.total === 0) return null;

  const done = state.total - state.pending;
  const isComplete = state.pending === 0;
  const message = isComplete
    ? t('memory.migrationSeedComplete')
    : t('memory.migrationSeedProgress', { done, total: state.total });

  return (
    <View style={styles.wrap} testID="migration-progress-banner">
      <View style={styles.row}>
        <Brain size={14} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('memory.migrationSeedTitle')}</Text>
          <Text style={styles.message} numberOfLines={2}>
            {message}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setDismissed(true)}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          testID="migration-progress-banner-dismiss"
          hitSlop={8}
        >
          <X size={14} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    wrap: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    title: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    message: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });

export default MigrationProgressBanner;
