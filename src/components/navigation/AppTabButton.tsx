import React from 'react';
import { StyleSheet, TouchableOpacity, type TouchableOpacityProps } from 'react-native';

type AppTabButtonProps = Omit<
  TouchableOpacityProps,
  'accessibilityLabel' | 'accessibilityRole' | 'accessibilityState'
> & {
  label: string;
  selected: boolean;
};

export function AppTabButton({
  children,
  disabled = false,
  label,
  selected,
  style,
  ...props
}: AppTabButtonProps) {
  return (
    <TouchableOpacity
      {...props}
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={disabled ? { disabled: true, selected } : { selected }}
      disabled={disabled}
      style={[style, styles.touchTarget]}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchTarget: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
});
