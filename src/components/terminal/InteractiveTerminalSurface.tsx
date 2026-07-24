import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  const [feedback, setFeedback] = useState<string | null>(null);

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
    try {
      const text = await ExpoClipboard.getStringAsync();
      if (text) {
        terminalRef.current?.paste(text);
        setFeedback(t('terminal.pasteComplete'));
      } else {
        setFeedback(t('terminal.clipboardEmpty'));
      }
    } catch {
      setFeedback(t('terminal.clipboardUnavailable'));
    }
  }, [t]);

  const handleSearch = useCallback(() => {
    const query = searchQuery.trim();
    if (query) {
      terminalRef.current?.search(query);
      setFeedback(t('terminal.searchComplete'));
    }
  }, [searchQuery, t]);

  const handleClear = useCallback(() => {
    terminalRef.current?.clear();
    setFeedback(t('terminal.clearComplete'));
  }, [t]);

  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.toolbar}>
        {feedback ? (
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={styles.feedback}
            testID="terminal-action-feedback"
          >
            {feedback}
          </Text>
        ) : (
          <View style={styles.feedback} />
        )}
        <TouchableOpacity
          onPress={() => setSearchVisible((current) => !current)}
          style={styles.toolbarBtn}
          accessibilityRole="button"
          accessibilityLabel={t('terminal.searchTerminal')}
          accessibilityState={{ expanded: searchVisible }}
        >
          <Search size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => void handlePaste()}
          style={styles.toolbarBtn}
          accessibilityRole="button"
          accessibilityLabel={t('terminal.pasteIntoTerminal')}
        >
          <ClipboardIcon size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleClear}
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
            accessibilityLabel={t('terminal.searchQueryLabel')}
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
            style={styles.toolbarBtn}
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
      gap: 4,
      minHeight: 52,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    toolbarBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
      width: 44,
    },
    feedback: {
      color: colors.textSecondary,
      flex: 1,
      fontSize: 12,
      paddingHorizontal: 4,
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
      minHeight: 44,
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
