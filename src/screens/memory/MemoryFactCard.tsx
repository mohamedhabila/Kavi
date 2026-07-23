import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react-native';

import type {
  MemoryFactRow,
  MemoryScreenPalette,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type MemoryFactCardProps = {
  colors: MemoryScreenPalette;
  fact: MemoryFactRow;
  onCorrect: (fact: MemoryFactRow) => void;
  onForget: (fact: MemoryFactRow) => void;
  onTogglePin: (fact: MemoryFactRow) => void;
  t: MemoryScreenTranslation;
  testIDPrefix?: string;
};

function readableLabel(value: string): string {
  const normalized = value.replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1) : value;
}

export function MemoryFactCard({
  colors,
  fact,
  onCorrect,
  onForget,
  onTogglePin,
  t,
  testIDPrefix = 'memory-fact',
}: MemoryFactCardProps) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const subject = /^(user|self)$/iu.test(fact.subject.trim())
    ? t('memory.aboutYou')
    : readableLabel(fact.subject);

  return (
    <View style={styles.memoryCard} testID={`${testIDPrefix}-${fact.id}`}>
      <View style={styles.memoryCardHeader}>
        <View style={styles.memoryCardHeading}>
          <Text style={styles.memoryCardSubject}>{subject}</Text>
          <Text style={styles.memoryCardLabel}>{readableLabel(fact.predicate)}</Text>
        </View>
        {fact.pinned ? (
          <View style={styles.memoryPinnedBadge} accessibilityLabel={t('memory.factPinned')}>
            <Pin size={13} color={colors.primary} />
            <Text style={styles.memoryPinnedBadgeText}>{t('memory.factPinned')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.memoryCardValue}>{fact.value}</Text>
      <View style={styles.memoryCardActions}>
        <TouchableOpacity
          accessibilityLabel={fact.pinned ? t('memory.factUnpin') : t('memory.factPin')}
          accessibilityRole="button"
          onPress={() => onTogglePin(fact)}
          style={styles.memoryCardAction}
          testID={`${testIDPrefix}-pin-${fact.id}`}
        >
          {fact.pinned ? (
            <PinOff size={16} color={colors.primary} />
          ) : (
            <Pin size={16} color={colors.textSecondary} />
          )}
          <Text style={styles.memoryCardActionText}>
            {fact.pinned ? t('memory.factUnpin') : t('memory.factPin')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel={t('memory.factCorrect')}
          accessibilityRole="button"
          onPress={() => onCorrect(fact)}
          style={styles.memoryCardAction}
          testID={`${testIDPrefix}-correct-${fact.id}`}
        >
          <Pencil size={16} color={colors.textSecondary} />
          <Text style={styles.memoryCardActionText}>{t('memory.factCorrect')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel={t('memory.factForget')}
          accessibilityRole="button"
          onPress={() => onForget(fact)}
          style={styles.memoryCardAction}
          testID={`${testIDPrefix}-forget-${fact.id}`}
        >
          <Trash2 size={16} color={colors.danger} />
          <Text style={[styles.memoryCardActionText, styles.memoryCardDangerText]}>
            {t('memory.factForget')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function createStyles(colors: MemoryScreenPalette) {
  return StyleSheet.create({
    memoryCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 8,
      marginBottom: 10,
      padding: 14,
    },
    memoryCardHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
    },
    memoryCardHeading: { flex: 1, gap: 2 },
    memoryCardSubject: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    memoryCardLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    memoryPinnedBadge: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 999,
      flexDirection: 'row',
      gap: 4,
      minHeight: 28,
      paddingHorizontal: 9,
    },
    memoryPinnedBadgeText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    memoryCardValue: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 23,
    },
    memoryCardActions: {
      alignItems: 'center',
      borderTopColor: colors.subtleBorder,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      justifyContent: 'space-between',
      paddingTop: 6,
    },
    memoryCardAction: {
      alignItems: 'center',
      borderRadius: 10,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: 44,
      minWidth: 78,
      paddingHorizontal: 8,
    },
    memoryCardActionText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    memoryCardDangerText: { color: colors.danger },
  });
}
