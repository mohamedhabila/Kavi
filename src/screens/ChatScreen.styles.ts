import { StyleSheet } from 'react-native';
import type { AppPalette } from '../theme/useAppTheme';
import { createChatHeaderStyles } from './ChatScreen.headerStyles';
import { createChatLayoutStyles } from './ChatScreen.layoutStyles';
import { createChatLogStyles } from './ChatScreen.logStyles';
import { createChatMessageStyles } from './ChatScreen.messageStyles';
import { createChatTelemetryStyles } from './ChatScreen.telemetryStyles';

export const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    ...createChatLayoutStyles(colors),
    ...createChatHeaderStyles(colors),
    ...createChatTelemetryStyles(colors),
    ...createChatLogStyles(colors),
    ...createChatMessageStyles(colors),
  });
