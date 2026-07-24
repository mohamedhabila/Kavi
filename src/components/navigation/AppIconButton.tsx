import React from 'react';
import { StyleSheet, TouchableOpacity, type TouchableOpacityProps } from 'react-native';

type AppIconButtonProps = Omit<
  TouchableOpacityProps,
  'accessibilityLabel' | 'accessibilityRole' | 'accessibilityState'
> & {
  label: string;
};

export function AppIconButton({
  children,
  disabled = false,
  label,
  style,
  ...props
}: AppIconButtonProps) {
  return (
    <TouchableOpacity
      {...props}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
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
    minWidth: 48,
  },
});
