import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AlertTriangle, File as FileIcon } from 'lucide-react-native';
import type { AppPalette } from '../../theme/useAppTheme';

type ConversationFilesStatusViewProps = {
  colors: AppPalette;
  detail?: string | null;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  status: 'loading' | 'empty' | 'error';
  testID: string;
  title: string;
};

export const ConversationFilesStatusView: React.FC<ConversationFilesStatusViewProps> = ({
  colors,
  detail,
  hint,
  onRetry,
  retryLabel,
  status,
  testID,
  title,
}) => {
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container} testID={testID} accessibilityLiveRegion="polite">
      {status === 'loading' ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : status === 'error' ? (
        <AlertTriangle size={36} color={colors.danger} />
      ) : (
        <FileIcon size={40} color={colors.textTertiary} />
      )}
      <Text style={[styles.title, status === 'error' ? styles.errorTitle : null]}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {detail ? (
        <Text style={styles.detail} selectable>
          {detail}
        </Text>
      ) : null}
      {onRetry && retryLabel ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          style={styles.retryButton}
          testID={`${testID}-retry`}
        >
          <Text style={styles.retryLabel}>{retryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      paddingVertical: 48,
      gap: 8,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    errorTitle: {
      color: colors.text,
    },
    hint: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: 'center',
      lineHeight: 18,
    },
    detail: {
      marginTop: 4,
      fontSize: 12,
      color: colors.textTertiary,
      textAlign: 'center',
      lineHeight: 17,
    },
    retryButton: {
      minHeight: 44,
      minWidth: 96,
      marginTop: 8,
      paddingHorizontal: 18,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    retryLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
  });
