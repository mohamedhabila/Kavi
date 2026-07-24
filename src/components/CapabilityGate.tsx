import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CheckCircle2, CircleAlert, CircleOff, Settings2, Zap } from 'lucide-react-native';

import { useAppTheme, type AppPalette } from '../theme/useAppTheme';

export type CapabilityGateState =
  | 'unavailable'
  | 'setup-needed'
  | 'loading'
  | 'ready'
  | 'active'
  | 'error';

type CapabilityGateProps = {
  actionDisabled?: boolean;
  actionLabel?: string;
  advancedLabel?: string;
  description: string;
  onAction?: () => void;
  state: CapabilityGateState;
  testID?: string;
  title: string;
};

function getStatePresentation(state: CapabilityGateState, colors: AppPalette) {
  switch (state) {
    case 'setup-needed':
      return {
        Icon: Settings2,
        accent: colors.warning,
        background: colors.warningBackground,
      };
    case 'ready':
      return {
        Icon: CheckCircle2,
        accent: colors.success,
        background: colors.primarySoft,
      };
    case 'active':
      return {
        Icon: Zap,
        accent: colors.primary,
        background: colors.primarySoft,
      };
    case 'error':
      return {
        Icon: CircleAlert,
        accent: colors.danger,
        background: colors.dangerSoft,
      };
    case 'unavailable':
      return {
        Icon: CircleOff,
        accent: colors.textSecondary,
        background: colors.surfaceAlt,
      };
    case 'loading':
    default:
      return {
        Icon: Settings2,
        accent: colors.primary,
        background: colors.surfaceAlt,
      };
  }
}

export function CapabilityGate({
  actionDisabled = false,
  actionLabel,
  advancedLabel,
  description,
  onAction,
  state,
  testID = 'capability-gate',
  title,
}: CapabilityGateProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const presentation = getStatePresentation(state, colors);
  const Icon = presentation.Icon;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.container, { backgroundColor: presentation.background }]}
      testID={testID}
    >
      <View style={styles.topRow}>
        <View accessibilityElementsHidden importantForAccessibility="no" style={styles.iconWrap}>
          {state === 'loading' ? (
            <ActivityIndicator color={presentation.accent} size="small" />
          ) : (
            <Icon color={presentation.accent} size={20} />
          )}
        </View>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {advancedLabel ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{advancedLabel}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.description}>{description}</Text>
        </View>
      </View>
      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: actionDisabled }}
          disabled={actionDisabled}
          onPress={onAction}
          style={[
            styles.action,
            { borderColor: presentation.accent },
            actionDisabled ? styles.actionDisabled : null,
          ]}
          testID={`${testID}-action`}
        >
          <Text style={[styles.actionText, { color: presentation.accent }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      borderRadius: 12,
      gap: 10,
      marginBottom: 12,
      padding: 12,
    },
    topRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 10,
    },
    iconWrap: {
      alignItems: 'center',
      height: 24,
      justifyContent: 'center',
      width: 24,
    },
    copy: {
      flex: 1,
      gap: 4,
    },
    titleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    title: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    description: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    badge: {
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    badgeText: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    },
    action: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      borderRadius: 10,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    actionDisabled: {
      opacity: 0.45,
    },
    actionText: {
      fontSize: 13,
      fontWeight: '700',
    },
  });
