import React from 'react';
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowLeft, Menu } from 'lucide-react-native';
import { useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { getRouteReturnTarget, useBackToChat } from '../../navigation/useBackToChat';

type RouteLeadingButtonProps = {
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const RouteLeadingButton: React.FC<RouteLeadingButtonProps> = ({ style, testID }) => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const hasParent = Boolean(getRouteReturnTarget(route.params?.returnTo));

  return (
    <TouchableOpacity
      accessibilityLabel={hasParent ? t('common.back') : t('chat.openMenu')}
      accessibilityRole="button"
      hitSlop={4}
      onPress={hasParent ? handleBack : () => navigation.openDrawer()}
      style={[styles.button, style]}
      testID={testID ?? (hasParent ? 'route-leading-back' : 'route-leading-menu')}
    >
      {hasParent ? (
        <ArrowLeft size={24} color={colors.text} />
      ) : (
        <Menu size={24} color={colors.text} />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
