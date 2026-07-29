import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH } from '../../services/memory/memoryTools';
import type {
  MemoryFactRow,
  MemoryScreenPalette,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type MemoryCorrectionModalProps = {
  colors: MemoryScreenPalette;
  error: string | null;
  fact: MemoryFactRow | null;
  onCancel: () => void;
  onEdit: () => void;
  onSave: (value: string) => void;
  t: MemoryScreenTranslation;
};

function readableLabel(value: string): string {
  return value.replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function MemoryCorrectionModal({
  colors,
  error,
  fact,
  onCancel,
  onEdit,
  onSave,
  t,
}: MemoryCorrectionModalProps) {
  const [value, setValue] = useState('');
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    setValue(fact?.value ?? '');
  }, [fact]);

  if (!fact) return null;

  const trimmed = value.trim();
  const tooLong = value.length > MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH;
  const saveDisabled = !trimmed || tooLong || trimmed === fact.value;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible
      testID="memory-correction-modal"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.correctionBackdrop}
      >
        <Pressable
          accessible={false}
          onPress={onCancel}
          style={styles.correctionDismissArea}
          testID="memory-correction-backdrop"
        />
        <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={styles.correctionSheet}>
          <Text accessibilityRole="header" style={styles.correctionTitle}>
            {t('memory.correctionTitle')}
          </Text>
          <Text style={styles.correctionHint}>
            {t('memory.correctionHint', { label: readableLabel(fact.predicate) })}
          </Text>
          <TextInput
            accessibilityLabel={t('memory.correctionInputLabel')}
            autoCapitalize="sentences"
            autoCorrect
            autoFocus
            multiline
            onChangeText={(nextValue) => {
              setValue(nextValue);
              if (error) onEdit();
            }}
            placeholder={t('memory.correctionPlaceholder')}
            selectTextOnFocus
            spellCheck
            style={styles.correctionInput}
            testID="memory-correction-input"
            value={value}
          />
          <View style={styles.correctionFeedbackRow}>
            <Text
              accessibilityLiveRegion="polite"
              style={error || tooLong ? styles.correctionError : styles.correctionCount}
              testID="memory-correction-feedback"
            >
              {error ??
                (tooLong
                  ? t('memory.correctionTooLong', {
                      count: MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH,
                    })
                  : `${value.length}/${MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH}`)}
            </Text>
          </View>
          <View style={styles.correctionActions}>
            <TouchableOpacity
              accessibilityLabel={t('common.cancel')}
              accessibilityRole="button"
              onPress={onCancel}
              style={styles.correctionSecondaryButton}
              testID="memory-correction-cancel"
            >
              <Text style={styles.correctionSecondaryText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={t('common.save')}
              accessibilityRole="button"
              accessibilityState={{ disabled: saveDisabled }}
              disabled={saveDisabled}
              onPress={() => onSave(value)}
              style={[
                styles.correctionPrimaryButton,
                saveDisabled && styles.correctionPrimaryButtonDisabled,
              ]}
              testID="memory-correction-save"
            >
              <Text style={styles.correctionPrimaryText}>{t('common.save')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: MemoryScreenPalette) {
  return StyleSheet.create({
    correctionBackdrop: {
      backgroundColor: colors.overlay,
      flex: 1,
      justifyContent: 'flex-end',
    },
    correctionDismissArea: { flex: 1 },
    correctionSheet: {
      backgroundColor: colors.background,
      borderColor: colors.border,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 10,
      paddingBottom: 16,
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    correctionTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
    },
    correctionHint: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
    },
    correctionInput: {
      backgroundColor: colors.inputBackground,
      borderColor: colors.inputBorder,
      borderRadius: 12,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
      minHeight: 108,
      paddingHorizontal: 12,
      paddingVertical: 12,
      textAlignVertical: 'top',
    },
    correctionFeedbackRow: {
      alignItems: 'flex-start',
      minHeight: 20,
    },
    correctionCount: { color: colors.textTertiary, fontSize: 12 },
    correctionError: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    correctionActions: {
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'flex-end',
    },
    correctionSecondaryButton: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 100,
      paddingHorizontal: 16,
    },
    correctionSecondaryText: { color: colors.text, fontSize: 14, fontWeight: '700' },
    correctionPrimaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      justifyContent: 'center',
      minHeight: 48,
      minWidth: 100,
      paddingHorizontal: 16,
    },
    correctionPrimaryButtonDisabled: { opacity: 0.45 },
    correctionPrimaryText: { color: colors.onPrimary, fontSize: 14, fontWeight: '700' },
  });
}
