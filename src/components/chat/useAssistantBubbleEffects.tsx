import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import type { AppPalette } from '../../theme/useAppTheme';
import type { Message } from '../../types/message';
import type { AssistantBubbleStyles } from './AssistantBubble.styles';

type UseAssistantBubbleEffectsParams = {
  colors: AppPalette;
  effectId: Message['effectId'];
  styles: AssistantBubbleStyles;
};

export function useAssistantBubbleEffects(params: UseAssistantBubbleEffectsParams) {
  const { colors, effectId, styles } = params;
  const effectProgress = useRef(new Animated.Value(effectId ? 0 : 1)).current;
  const previousEffectIdRef = useRef<Message['effectId']>(effectId);

  useEffect(() => {
    if (!effectId) {
      if (previousEffectIdRef.current) {
        effectProgress.setValue(1);
      }
      previousEffectIdRef.current = effectId;
      return;
    }

    previousEffectIdRef.current = effectId;
    effectProgress.setValue(0);
    Animated.timing(effectProgress, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [effectId, effectProgress]);

  const bubbleAnimationStyle = useMemo(
    () => ({
      opacity: effectProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.72, 1],
      }),
      transform: [
        {
          scale: effectProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
      ],
    }),
    [effectProgress],
  );

  const effectDecorations = useMemo(() => {
    if (effectId === 'confetti') {
      return Array.from({ length: 6 }, (_, index) => {
        const translateY = effectProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [-10 - index * 4, 12 + index * 2],
        });
        const translateX = effectProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [index % 2 === 0 ? -8 : 8, index % 2 === 0 ? 10 : -10],
        });
        return (
          <Animated.View
            key={`confetti-${index}`}
            testID={index === 0 ? 'message-effect-confetti' : undefined}
            style={[
              styles.effectDot,
              {
                backgroundColor:
                  index % 3 === 0
                    ? colors.primary
                    : index % 3 === 1
                      ? colors.link
                      : colors.textSecondary,
                left: 12 + index * 14,
                transform: [{ translateX }, { translateY }],
                opacity: effectProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.9, 0],
                }),
              },
            ]}
          />
        );
      });
    }

    if (effectId === 'balloons') {
      return Array.from({ length: 3 }, (_, index) => {
        const translateY = effectProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [18 + index * 10, -20 - index * 6],
        });
        return (
          <Animated.View
            key={`balloon-${index}`}
            testID={index === 0 ? 'message-effect-balloons' : undefined}
            style={[
              styles.effectBalloon,
              {
                backgroundColor:
                  index === 0
                    ? colors.primary
                    : index === 1
                      ? colors.link
                      : colors.textSecondary,
                right: 12 + index * 24,
                transform: [{ translateY }],
                opacity: effectProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 0],
                }),
              },
            ]}
          />
        );
      });
    }

    if (effectId === 'spotlight') {
      return [
        <Animated.View
          key="spotlight"
          testID="message-effect-spotlight"
          style={[
            styles.effectSpotlight,
            {
              opacity: effectProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.32, 0.08],
              }),
              transform: [
                {
                  scale: effectProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1.08],
                  }),
                },
              ],
            },
          ]}
        />,
      ];
    }

    return [];
  }, [colors, effectId, effectProgress, styles]);

  return {
    bubbleAnimationStyle,
    effectDecorations,
  };
}
