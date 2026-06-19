import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../i18n/useTranslation';
import {
  formatBudgetLayerBreakdown,
  formatRetrievalIdList,
  type MemoryDiagnosticsSnapshot,
} from '../../services/memory/memoryDiagnostics';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';

interface MemoryDiagnosticsPanelProps {
  diagnostics: MemoryDiagnosticsSnapshot;
}

function createStyles(colors: AppPalette) {
  return StyleSheet.create({
    container: {
      gap: 10,
      marginTop: 8,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 4,
    },
    scopeLine: {
      color: colors.textTertiary,
      fontSize: 11,
    },
    row: {
      gap: 2,
      paddingVertical: 4,
    },
    rowPrimary: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '500',
    },
    rowSecondary: {
      color: colors.textTertiary,
      fontSize: 11,
    },
    emptyText: {
      color: colors.textTertiary,
      fontSize: 12,
      fontStyle: 'italic',
    },
  });
}

export const MemoryDiagnosticsPanel: React.FC<MemoryDiagnosticsPanelProps> = ({
  diagnostics,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container} testID="memory-diagnostics-panel">
      <Text style={styles.sectionTitle}>{t('memory.diagnosticsTitle')}</Text>

      <Text style={styles.sectionTitle}>{t('memory.diagnosticsBudgetTitle')}</Text>
      {diagnostics.budgetEntries.length === 0 ? (
        <Text style={styles.emptyText} testID="memory-diagnostics-budget-empty">
          {t('memory.diagnosticsBudgetEmpty')}
        </Text>
      ) : (
        diagnostics.budgetEntries.map((entry) => {
          const layers = formatBudgetLayerBreakdown(entry.layers);
          return (
            <View
              key={`budget-${entry.timestamp}-${entry.iteration}`}
              style={styles.row}
              testID={`memory-diagnostics-budget-${entry.iteration}`}
            >
              <Text style={styles.rowPrimary}>
                {t('memory.diagnosticsBudgetEntry', {
                  iteration: entry.iteration,
                  model: entry.model,
                  total: entry.totalTokens,
                  window: entry.contextWindow,
                })}
              </Text>
              {layers ? <Text style={styles.rowSecondary}>{layers}</Text> : null}
            </View>
          );
        })
      )}

      <Text style={styles.sectionTitle}>{t('memory.diagnosticsRetrievalTitle')}</Text>
      {diagnostics.threadId ? (
        <Text style={styles.scopeLine} testID="memory-diagnostics-scope">
          {t('memory.diagnosticsScopeActiveConversation')}
        </Text>
      ) : null}
      {diagnostics.retrievalEntries.length === 0 ? (
        <Text style={styles.emptyText} testID="memory-diagnostics-retrieval-empty">
          {t('memory.diagnosticsRetrievalEmpty')}
        </Text>
      ) : (
        diagnostics.retrievalEntries.map((entry) => (
          <View
            key={entry.id}
            style={styles.row}
            testID={`memory-diagnostics-retrieval-${entry.id}`}
          >
            <Text style={styles.rowPrimary}>
              {t('memory.diagnosticsRetrievalEntry', {
                factCount: entry.factIds.length,
                episodeCount: entry.episodeIds.length,
                tokenEstimate: entry.tokenEstimate,
              })}
            </Text>
            <Text style={styles.rowSecondary}>
              facts: {formatRetrievalIdList(entry.factIds)}
            </Text>
            <Text style={styles.rowSecondary}>
              episodes: {formatRetrievalIdList(entry.episodeIds)}
            </Text>
            {entry.taskId ? (
              <Text style={styles.rowSecondary}>
                {t('memory.diagnosticsRetrievalTask', { taskId: entry.taskId })}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
};