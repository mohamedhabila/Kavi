import React, { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useTranslation } from '../../i18n';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import type { SubAgentSnapshot } from '../../types';
import {
  buildSubAgentRollupMap,
  buildSubAgentSubtree,
  getSubAgentDisplayName,
} from '../../services/agents/subAgentPresentation';
import { SubAgentActivityCard } from './SubAgentActivityCard';
import { SubAgentRollupCard } from './SubAgentRollupCard';

interface SubAgentDetailModalProps {
  visible: boolean;
  selectedSnapshot: SubAgentSnapshot | null;
  availableSnapshots: SubAgentSnapshot[];
  onClose: () => void;
}

export const SubAgentDetailModal: React.FC<SubAgentDetailModalProps> = ({
  visible,
  selectedSnapshot,
  availableSnapshots,
  onClose,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const rootSnapshot = useMemo(
    () =>
      selectedSnapshot
        ? availableSnapshots.find(
            (snapshot) => snapshot.sessionId === selectedSnapshot.sessionId,
          ) || selectedSnapshot
        : null,
    [availableSnapshots, selectedSnapshot],
  );

  const subtree = useMemo(
    () =>
      rootSnapshot
        ? buildSubAgentSubtree(availableSnapshots, rootSnapshot.sessionId, rootSnapshot)
        : [],
    [availableSnapshots, rootSnapshot],
  );

  const rollup = useMemo(() => {
    if (!rootSnapshot) {
      return undefined;
    }
    const subtreeSnapshots = subtree.map((node) => node.snapshot);
    return buildSubAgentRollupMap(subtreeSnapshots).get(rootSnapshot.sessionId);
  }, [rootSnapshot, subtree]);

  if (!rootSnapshot) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <X size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {getSubAgentDisplayName(rootSnapshot)}
            </Text>
            <Text style={styles.headerSubtitle}>{t('chat.subAgentWorkerTree')}</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} testID="sub-agent-detail-modal-scroll">
          <SubAgentActivityCard
            snapshot={rootSnapshot}
            visualDepth={0}
            variant="detail"
            defaultExpanded
          />

          {rollup && rollup.descendantCount > 0 ? (
            <SubAgentRollupCard rootSnapshot={rootSnapshot} rollup={rollup} />
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('chat.subAgentWorkerTree')}</Text>
            <Text style={styles.sectionMeta}>{subtree.length}</Text>
          </View>

          {subtree.length > 1 ? (
            subtree
              .slice(1)
              .map((node) => (
                <SubAgentActivityCard
                  key={`detail-${node.snapshot.sessionId}`}
                  snapshot={node.snapshot}
                  visualDepth={node.visualDepth}
                  variant="detail"
                />
              ))
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('chat.subAgentWorkerTreeEmpty')}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.header,
    },
    headerTextWrap: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      gap: 2,
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    headerSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    headerSpacer: {
      width: 22,
      height: 22,
    },
    content: {
      padding: 16,
      gap: 14,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    sectionMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    emptyCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: 14,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
  });
