import React from 'react';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';

type ChatKeyboardSpacerProps = {
  /** Bottom safe-area padding the composer already reserves below its controls. */
  bottomInset: number;
};

/**
 * Space under the composer that grows with the on-screen keyboard, frame by frame, so
 * the composer rides on top of the keyboard and the transcript above shrinks to fit.
 *
 * The window is no longer resized for the keyboard: Android 15+ draws apps edge to
 * edge, where `adjustResize` has no effect, and iOS never resizes. The keyboard's height
 * is measured from the bottom of the screen, through the area the composer already pads
 * for the safe-area inset, so only the rest of it is added here.
 */
export function ChatKeyboardSpacer({ bottomInset }: ChatKeyboardSpacerProps) {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({
    // `height` runs from 0 (closed) to minus the keyboard height (open).
    height: Math.max(-height.value - bottomInset, 0),
  }));
  return <Reanimated.View style={style} testID="chat-keyboard-spacer" />;
}
