import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Save } from 'lucide-react-native';

import type {
  MemoryBlockRow,
  MemoryScreenPalette,
  MemoryScreenStyles,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type BlocksSectionProps = {
  blockDrafts: Record<string, string>;
  blocks: MemoryBlockRow[];
  colors: MemoryScreenPalette;
  handleBlockDraftChange: (label: string, content: string) => void;
  handleBlockSave: (label: string) => void;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
};

export function BlocksSection({
  blockDrafts,
  blocks,
  colors,
  handleBlockDraftChange,
  handleBlockSave,
  styles,
  t,
}: BlocksSectionProps) {
  return (
    <ScrollView style={styles.editorContainer} testID="memory-blocks-tab">
      {blocks.length === 0 ? (
        <Text style={styles.emptyText}>{t('memory.blocksEmpty')}</Text>
      ) : (
        blocks.map((block) => {
          const draft = blockDrafts[block.label] ?? block.content;
          return (
            <View key={block.label} style={styles.blockCard} testID={`memory-block-${block.label}`}>
              <Text style={styles.factSubject}>{block.label}</Text>
              <Text style={styles.statusLine}>{block.description}</Text>
              <TextInput
                style={[styles.editor, styles.blockEditor]}
                value={draft}
                onChangeText={(text) => handleBlockDraftChange(block.label, text)}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                testID={`memory-block-editor-${block.label}`}
              />
              <View style={styles.factActions}>
                <Text style={styles.statusLine}>
                  {t('memory.blockChars', {
                    used: draft.length,
                    limit: block.charLimit,
                  })}
                </Text>
                <TouchableOpacity
                  onPress={() => handleBlockSave(block.label)}
                  accessibilityLabel={t('memory.blockSave')}
                  testID={`memory-block-save-${block.label}`}
                >
                  <Save size={18} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}
