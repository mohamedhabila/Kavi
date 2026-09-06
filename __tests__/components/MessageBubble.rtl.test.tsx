// ---------------------------------------------------------------------------
// Tests — MessageBubble / AssistantBubble mirroring under RTL
// ---------------------------------------------------------------------------
// User and assistant bubbles align to opposite sides using LOGICAL flexbox
// values (`alignItems: 'flex-end'` / `'flex-start'`) and a LOGICAL corner
// radius (`borderBottomEndRadius` / `borderBottomStartRadius`), not a
// hardcoded physical side. Yoga (React Native's layout engine) mirrors
// `flex-start`/`flex-end` itself once the root layout direction is RTL —
// see `resolveCrossDirection`/`resolveDirection` in
// node_modules/react-native/ReactCommon/yoga/yoga/algorithm/FlexDirection.h,
// which route a column container's horizontal cross-axis through the same
// row-direction-reversal logic used for `flexDirection: 'row'`. That native
// mirroring isn't observable from a JS-only render (react-test-renderer
// never runs Yoga), so what this test actually proves — the meaningful,
// JS-visible half of the fix — is that the styles the component emits are
// direction-agnostic: the same logical style names and values are used
// regardless of `I18nManager.isRTL`, and the old hardcoded
// `borderBottomRightRadius`/`borderBottomLeftRadius` never reappears.

import { render } from '@testing-library/react-native';
import { I18nManager, StyleSheet } from 'react-native';
import React from 'react';
import {
  MessageBubble,
  installMessageBubbleTestHarness,
  makeMessage,
} from '../helpers/messageBubbleHarness';

describe('MessageBubble/AssistantBubble RTL-safe alignment', () => {
  installMessageBubbleTestHarness();

  const originalIsRTL = I18nManager.isRTL;

  afterEach(() => {
    (I18nManager as unknown as { isRTL: boolean }).isRTL = originalIsRTL;
  });

  it.each([false, true])('user bubble stays end-aligned with a logical tail corner (isRTL=%s)', (isRTL) => {
    (I18nManager as unknown as { isRTL: boolean }).isRTL = isRTL;

    const msg = makeMessage({ role: 'user', content: 'Hello' });
    const { getByTestId } = render(<MessageBubble message={msg} />);

    const wrapperStyle = StyleSheet.flatten(getByTestId('message-user-wrapper').props.style);
    expect(wrapperStyle.alignItems).toBe('flex-end');

    const bubbleStyle = StyleSheet.flatten(getByTestId('message-user-bubble').props.style);
    expect(bubbleStyle.borderBottomEndRadius).toBe(4);
    expect(bubbleStyle.borderBottomRightRadius).toBeUndefined();
    expect(bubbleStyle.borderBottomLeftRadius).toBeUndefined();
  });

  it.each([false, true])(
    'assistant bubble stays start-aligned with a logical tail corner (isRTL=%s)',
    (isRTL) => {
      (I18nManager as unknown as { isRTL: boolean }).isRTL = isRTL;

      const msg = makeMessage({ role: 'assistant', content: 'Hi there' });
      const { getByTestId } = render(<MessageBubble message={msg} />);

      const wrapperStyle = StyleSheet.flatten(getByTestId('message-assistant-wrapper').props.style);
      expect(wrapperStyle.alignItems).toBe('flex-start');

      const bubbleStyle = StyleSheet.flatten(getByTestId('message-assistant-bubble').props.style);
      expect(bubbleStyle.borderBottomStartRadius).toBe(8);
      expect(bubbleStyle.borderBottomRightRadius).toBeUndefined();
      expect(bubbleStyle.borderBottomLeftRadius).toBeUndefined();
    },
  );
});
