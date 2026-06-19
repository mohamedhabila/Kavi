import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Clipboard as ClipboardIcon, Search, Trash2, X } from 'lucide-react-native';
import * as ExpoClipboard from 'expo-clipboard';
import { useTranslation } from '../../i18n/useTranslation';
import { useAppTheme, type AppPalette } from '../../theme/useAppTheme';
import {
  TerminalWebView,
  type TerminalWebViewProps,
  type TerminalWebViewRef,
} from './TerminalWebView';

export interface InteractiveTerminalSurfaceProps extends Omit<TerminalWebViewProps, 'colors'> {
  colors?: AppPalette;
  searchPlaceholder?: string;
}

export const InteractiveTerminalSurface = forwardRef<
  TerminalWebViewRef,
  InteractiveTerminalSurfaceProps
>(function InteractiveTerminalSurface(props, ref) {
  const {
    colors: providedColors,
    searchPlaceholder: providedSearchPlaceholder,
    style,
    ...terminalProps
  } = props;
  const { t } = useTranslation();
  const { colors: themeColors } = useAppTheme();
  const colors = providedColors ?? themeColors;
  const searchPlaceholder = providedSearchPlaceholder ?? t('terminal.searchPlaceholder');
  const terminalRef = useRef<TerminalWebViewRef>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useImperativeHandle(
    ref,
    () => ({
      write: (data: string) => terminalRef.current?.write(data),
      writeln: (data: string) => terminalRef.current?.writeln(data),
      clear: () => terminalRef.current?.clear(),
      reset: () => terminalRef.current?.reset(),
      focus: () => terminalRef.current?.focus(),
      paste: (text: string) => terminalRef.current?.paste(text),
      search: (query: string) => terminalRef.current?.search(query),
      updateTheme: (theme) => terminalRef.current?.updateTheme(theme),
      updateConfig: (config) => terminalRef.current?.updateConfig(config),
      fit: () => terminalRef.current?.fit(),
    }),
    [],
  );

  const handlePaste = useCallback(async () => {
    const text = await ExpoClipboard.getStringAsync();
    if (text) {
      terminalRef.current?.paste(text);
    }
  }, []);

  const handleSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (query) {
      terminalRef.current?.search(query);
    }
  }, [searchQuery]);

  const styles = createStyles(colors);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.toolbar}>
        <TouchableOpacity
          onPress={() => setSearchVisible((current) => !current)}
          hitSlop={8}
          style={styles.toolbarBtn}
          accessibilityRole="button"
          accessibilityLabel={t('terminal.searchTerminal')}
        >
          <Search size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void handlePaste()}
          hitSlop={8}
          style={styles.toolbarBtn}
          accessibilityRole="button"
          accessibilityLabel={t('terminal.pasteIntoTerminal')}
        >
          <ClipboardIcon size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => terminalRef.current?.clear()}
          hitSlop={8}
          style={styles.toolbarBtn}
          accessibilityRole="button"
          accessibilityLabel={t('terminal.clearTerminal')}
        >
          <Trash2 size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {searchVisible ? (
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <TouchableOpacity
            onPress={() => setSearchVisible(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('terminal.closeTerminalSearch')}
          >
            <X size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}

      <TerminalWebView
        ref={terminalRef}
        {...terminalProps}
        colors={colors}
        style={styles.terminal}
      />
    </View>
  );
});

function createStyles(colors: AppPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    toolbarBtn: {
      padding: 4,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: colors.text,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: colors.inputBackground,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    terminal: {
      flex: 1,
    },
  });
}
