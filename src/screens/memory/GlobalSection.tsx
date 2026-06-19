import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { MemoryScreenPalette, MemoryScreenStyles, MemoryScreenTranslation } from './memoryScreenTypes';

type GlobalSectionProps = {
  charCount: number;
  dirty: boolean;
  globalContent: string;
  handleGlobalChange: (text: string) => void;
  hasExternalGlobalUpdate: boolean;
  lineCount: number;
  loadGlobalMemory: (preserveDirty?: boolean) => Promise<void>;
  memoryStatus: string;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
  colors: MemoryScreenPalette;
};

export function GlobalSection({
  charCount,
  dirty,
  globalContent,
  handleGlobalChange,
  hasExternalGlobalUpdate,
  lineCount,
  loadGlobalMemory,
  memoryStatus,
  styles,
  t,
  colors,
}: GlobalSectionProps) {
  return (
    <View style={styles.editorContainer}>
      <Text style={styles.statsLine}>
        {dirty
          ? t('memory.statsLineDirty', { lines: lineCount, chars: charCount })
          : t('memory.statsLine', { lines: lineCount, chars: charCount })}
      </Text>
      <Text style={styles.statusLine}>{memoryStatus}</Text>
      {hasExternalGlobalUpdate ? (
        <View style={styles.noticeRow}>
          <Text style={styles.noticeText}>{t('memory.externalUpdate')}</Text>
          <TouchableOpacity onPress={() => void loadGlobalMemory(false)}>
            <Text style={styles.noticeAction}>{t('common.refresh')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <ScrollView style={styles.editorScroll} keyboardDismissMode="interactive">
        <TextInput
          style={styles.editor}
          value={globalContent}
          onChangeText={handleGlobalChange}
          multiline
          placeholder={t('memory.emptyHint')}
          placeholderTextColor={colors.placeholder}
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </ScrollView>
    </View>
  );
}
