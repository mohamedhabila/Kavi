import { ChevronDown, ChevronRight } from 'lucide-react-native';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
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
        {open ? (
          <ChevronDown size={18} color={colors.textSecondary} />
        ) : (
          <ChevronRight size={18} color={colors.textSecondary} />
        )}
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
  ScrollView,
  SettingsManagedScrollViewProps
>(({ children, style, contentContainerStyle, onTrackedScroll, onRestore }, ref) => (
  <ScrollView
    ref={ref}
    style={style}
    contentContainerStyle={contentContainerStyle}
    keyboardShouldPersistTaps="handled"
    scrollEventThrottle={16}
    onScroll={(event) => onTrackedScroll(event.nativeEvent.contentOffset.y)}
    onContentSizeChange={onRestore}
  >
    {children}
  </ScrollView>
));

SettingsManagedScrollView.displayName = 'SettingsManagedScrollView';
