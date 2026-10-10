import { ExpandCollapseChevronIcon } from '../../components/navigation/DirectionalIcons';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import { FOCUSED_INPUT_KEYBOARD_GAP } from '../../theme/keyboard';
import type { AppPalette } from '../../theme/useAppTheme';

type SettingsCollapsibleSectionProps = {
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  colors: AppPalette;
};

export const SettingsCollapsibleSection: React.FC<SettingsCollapsibleSectionProps> = ({
  title,
  children,
  open,
  onToggle,
  colors,
}) => {
  return (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: colors.surfaceAlt,
          borderRadius: 8,
          marginHorizontal: 16,
        }}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{title}</Text>
        <ExpandCollapseChevronIcon expanded={open} size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      {open && <View style={{ paddingTop: 4 }}>{children}</View>}
    </View>
  );
};

type SettingsManagedScrollViewProps = {
  children: React.ReactNode;
  style: any;
  contentContainerStyle?: any;
  onTrackedScroll: (y: number) => void;
  onRestore: () => void;
};

export const SettingsManagedScrollView = React.forwardRef<
  KeyboardAwareScrollViewRef,
  SettingsManagedScrollViewProps
>(({ children, style, contentContainerStyle, onTrackedScroll, onRestore }, ref) => (
  // Settings forms (keys, personas, tool access) run down the screen; the window is not
  // resized for the keyboard, so keep the focused field scrolled above it.
  <KeyboardAwareScrollView
    ref={ref}
    style={style}
    contentContainerStyle={contentContainerStyle}
    bottomOffset={FOCUSED_INPUT_KEYBOARD_GAP}
    keyboardShouldPersistTaps="handled"
    scrollEventThrottle={16}
    onScroll={(event) => onTrackedScroll(event.nativeEvent.contentOffset.y)}
    onContentSizeChange={onRestore}
  >
    {children}
  </KeyboardAwareScrollView>
));

SettingsManagedScrollView.displayName = 'SettingsManagedScrollView';
