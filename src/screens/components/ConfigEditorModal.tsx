import React from 'react';
import {
  Modal,
  ScrollView,
  StyleProp,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { useAppTheme } from '../../theme/useAppTheme';

export type ConfigEditorModalShellStyles = {
  container: StyleProp<ViewStyle>;
  header: StyleProp<ViewStyle>;
  titleWrap: StyleProp<ViewStyle>;
  title: StyleProp<TextStyle>;
  subtitle: StyleProp<TextStyle>;
  body: StyleProp<ViewStyle>;
};

type ConfigEditorModalProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeAccessibilityLabel: string;
  shellStyles: ConfigEditorModalShellStyles;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

export const ConfigEditorModal: React.FC<ConfigEditorModalProps> = ({
  visible,
  title,
  subtitle,
  onClose,
  closeAccessibilityLabel,
  shellStyles,
  contentContainerStyle,
  children,
}) => {
  const { colors } = useAppTheme();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={shellStyles.container} edges={['top']}>
        <View style={shellStyles.header}>
          <View style={shellStyles.titleWrap}>
            <Text style={shellStyles.title}>{title}</Text>
            {subtitle ? <Text style={shellStyles.subtitle}>{subtitle}</Text> : null}
          </View>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={closeAccessibilityLabel}
          >
            <X size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={shellStyles.body} contentContainerStyle={contentContainerStyle}>
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};
