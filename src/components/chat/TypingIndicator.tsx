// ---------------------------------------------------------------------------
// Kavi — Typing Indicator (animated dots for streaming)
// ---------------------------------------------------------------------------

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useTranslation } from '../../i18n';

interface TypingIndicatorProps {
  color?: string;
}

export default function TypingIndicator({ color = '#e94560' }: TypingIndicatorProps) {
  const { t } = useTranslation();
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const createPulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      );

    const a1 = createPulse(dot1, 0);
    const a2 = createPulse(dot2, 150);
    const a3 = createPulse(dot3, 300);

    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.container} accessibilityLabel={t('chat.assistantTyping')}>
      <Animated.View style={[styles.dot, { opacity: dot1, backgroundColor: color }]} />
      <Animated.View style={[styles.dot, { opacity: dot2, backgroundColor: color }]} />
      <Animated.View style={[styles.dot, { opacity: dot3, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
