import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Lock, Pin, PinOff, Trash2 } from 'lucide-react-native';

import type { MemoryItem } from '../../services/memory/core/memoryItemsStore';
import type { AppPalette } from '../../theme/useAppTheme';
import type { MemoryScreenStyles } from './memoryScreenStyles';

type MemoryItemCardProps = {
  colors: AppPalette;
  item: MemoryItem;
  savedOn: string;
  onForget: (item: MemoryItem) => void;
  onTogglePin: (item: MemoryItem) => void;
  styles: MemoryScreenStyles;
  t: (key: string) => string;
};

export function MemoryItemCard({
  colors,
  item,
  savedOn,
  onForget,
  onTogglePin,
  styles,
  t,
}: MemoryItemCardProps) {
  return (
    <View style={styles.card} testID={`memory-item-${item.id}`}>
      <Text style={styles.cardText}>{item.text}</Text>
      <View style={styles.cardMeta}>
        {item.pinned ? (
          <View style={styles.badge}>
            <Pin size={12} color={colors.primary} />
            <Text style={styles.badgeText}>{t('memory.pinned')}</Text>
          </View>
        ) : null}
        {item.sensitive ? (
          <View style={styles.badge}>
            <Lock size={12} color={colors.primary} />
            <Text style={styles.badgeText}>{t('memory.sensitive')}</Text>
          </View>
        ) : null}
        <Text style={styles.cardDate}>{savedOn}</Text>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity
          accessibilityLabel={item.pinned ? t('memory.unpin') : t('memory.pin')}
          accessibilityRole="button"
          onPress={() => onTogglePin(item)}
          style={styles.cardAction}
          testID={`memory-item-pin-${item.id}`}
        >
          {item.pinned ? (
            <PinOff size={16} color={colors.primary} />
          ) : (
            <Pin size={16} color={colors.textSecondary} />
          )}
          <Text style={styles.cardActionText}>
            {item.pinned ? t('memory.unpin') : t('memory.pin')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel={t('memory.forget')}
          accessibilityRole="button"
          onPress={() => onForget(item)}
          style={styles.cardAction}
          testID={`memory-item-forget-${item.id}`}
        >
          <Trash2 size={16} color={colors.danger} />
          <Text style={[styles.cardActionText, styles.dangerText]}>{t('memory.forget')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
