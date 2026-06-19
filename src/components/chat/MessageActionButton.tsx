import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';

export const MESSAGE_ACTION_BUTTON_SIZE = 44;

type MessageActionButtonProps = {
  accessibilityLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
};

export const MessageActionButton = React.memo(function MessageActionButton(
  props: MessageActionButtonProps,
) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[styles.button, props.disabled ? styles.disabled : null]}
      testID={props.testID}
    >
      {props.children}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  button: {
    minWidth: MESSAGE_ACTION_BUTTON_SIZE,
    minHeight: MESSAGE_ACTION_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: MESSAGE_ACTION_BUTTON_SIZE / 2,
    padding: 8,
  },
  disabled: {
    opacity: 0.45,
  },
});
