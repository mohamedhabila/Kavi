import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { ChatKeyboardSpacer } from '../../src/components/chat/ChatKeyboardSpacer';

// The composer was hidden behind the keyboard: Android 15+ draws apps edge to edge, so
// the window no longer resizes for it, and the chat screen had nothing else lifting the
// composer. The spacer under the composer now grows with the keyboard.

const mockedKeyboardAnimation = useReanimatedKeyboardAnimation as jest.Mock;

function keyboardAt(height: number) {
  mockedKeyboardAnimation.mockReturnValue({
    height: { value: -height },
    progress: { value: height > 0 ? 1 : 0 },
  });
}

function spacerHeight(): number {
  return StyleSheet.flatten(screen.getByTestId('chat-keyboard-spacer').props.style).height;
}

afterEach(() => {
  mockedKeyboardAnimation.mockReturnValue({
    height: { value: 0 },
    progress: { value: 0 },
  });
});

describe('ChatKeyboardSpacer', () => {
  it('takes no space while the keyboard is closed', () => {
    keyboardAt(0);
    render(<ChatKeyboardSpacer bottomInset={34} />);

    expect(spacerHeight()).toBe(0);
  });

  it('lifts the composer by the keyboard height beyond the inset it already pads', () => {
    keyboardAt(336);
    render(<ChatKeyboardSpacer bottomInset={34} />);

    expect(spacerHeight()).toBe(302);
  });

  it('lifts by the full keyboard height on a screen without a bottom inset', () => {
    keyboardAt(822);
    render(<ChatKeyboardSpacer bottomInset={0} />);

    expect(spacerHeight()).toBe(822);
  });

  it('never goes negative for a keyboard shorter than the inset', () => {
    keyboardAt(20);
    render(<ChatKeyboardSpacer bottomInset={34} />);

    expect(spacerHeight()).toBe(0);
  });
});
