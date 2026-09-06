// ---------------------------------------------------------------------------
// Kavi — ThinkingBlock Component
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Brain } from 'lucide-react-native';
import { ExpandCollapseChevronIcon } from '../navigation/DirectionalIcons';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';

interface ThinkingBlockProps {
  reasoning: string;
  isStreaming?: boolean;
  /**
   * True when `reasoning` holds an app-generated stand-in (e.g. a "Using
   * <tool>\u2026" progress label written while no genuine model reasoning has
   * streamed yet) rather than real model reasoning. Set by the producer that
   * wrote the placeholder \u2014 never inferred by matching the text itself, since
   * a reworded or non-English placeholder would otherwise leak through.
   */
  isSyntheticPlaceholder?: boolean;
}

const THINKING_COLLAPSED_HEIGHT = 30;
// Purely structural: reasoning made only of dots/ellipsis/whitespace carries no
// content regardless of who wrote it, so this check stays text-based by design.
const PLACEHOLDER_ONLY_REASONING_RE = /^[.\u2026\s]+$/u;

function collapseThinkingLabel(label: string): string {
  return label.replace(/\s*(?:\.\.\.|\u2026)\s*$/u, '');
}

export function getRenderableThinkingText(
  reasoning?: string | null,
  isSyntheticPlaceholder?: boolean,
): string | null {
  if (typeof reasoning !== 'string') {
    return null;
  }

  const normalized = reasoning.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  if (isSyntheticPlaceholder || PLACEHOLDER_ONLY_REASONING_RE.test(normalized)) {
    return null;
  }

  return normalized;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  reasoning,
  isStreaming,
  isSyntheticPlaceholder,
}) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [expanded, setExpanded] = useState(false);
  const opacity = useRef(new Animated.Value(0.5)).current;
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const renderableReasoning = getRenderableThinkingText(reasoning, isSyntheticPlaceholder);
  const thinkingLabel = isStreaming
    ? t('chat.thinking')
    : collapseThinkingLabel(t('chat.thinking'));

  useEffect(() => {
    pulseAnimationRef.current?.stop();
    pulseAnimationRef.current = null;

    if (isStreaming) {
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 600, useNativeDriver: true }),
        ]),
      );

      pulseAnimationRef.current = pulseAnimation;
      pulseAnimation.start();

      return () => {
        pulseAnimation.stop();
        pulseAnimationRef.current = null;
      };
    } else {
      opacity.stopAnimation();
      opacity.setValue(1);
    }

    return undefined;
  }, [isStreaming, opacity]);

  if (!renderableReasoning) return null;

  return (
    <View
      style={[styles.container, !expanded ? styles.containerCollapsed : null]}
      testID="thinking-block-container"
    >
      <TouchableOpacity
        style={[styles.header, !expanded ? styles.headerCollapsed : null]}
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? t('chat.collapseThinking') : t('chat.expandThinking')}
        testID="thinking-block-toggle"
      >
        <Animated.View style={{ opacity }}>
          <Brain size={14} color={colors.textTertiary} />
        </Animated.View>
        <Text
          style={styles.headerText}
          numberOfLines={1}
          ellipsizeMode="tail"
          testID="thinking-block-label"
        >
          {thinkingLabel}
        </Text>
        <ExpandCollapseChevronIcon expanded={expanded} size={14} color={colors.textTertiary} />
      </TouchableOpacity>
      {expanded && (
        <View style={styles.contentContainer}>
          <Text style={styles.content} selectable>
            {renderableReasoning}
          </Text>
        </View>
      )}
    </View>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      marginVertical: 4,
      borderStartWidth: 2,
      borderStartColor: colors.subtleBorder,
      paddingStart: 8,
      minWidth: 0,
      alignSelf: 'stretch',
    },
    containerCollapsed: {
      height: THINKING_COLLAPSED_HEIGHT,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
      minWidth: 0,
    },
    headerCollapsed: {
      height: THINKING_COLLAPSED_HEIGHT,
      paddingVertical: 0,
    },
    headerText: {
      fontSize: 12,
      color: colors.textTertiary,
      fontStyle: 'italic',
      flex: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    contentContainer: {
      paddingBottom: 4,
    },
    content: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      flexShrink: 1,
    },
  });
