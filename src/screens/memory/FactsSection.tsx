import React from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { MemoryFactCard } from './MemoryFactCard';

import type {
  MemoryEpisodeRow,
  MemoryFactRow,
  MemoryScreenPalette,
  MemoryScreenStyles,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type FactsSectionProps = {
  colors: MemoryScreenPalette;
  episodes: MemoryEpisodeRow[];
  facts: MemoryFactRow[];
  factsFilter: string;
  factsPinnedOnly: boolean;
  handleFactCorrect: (fact: MemoryFactRow) => void;
  handleFactForget: (fact: MemoryFactRow) => void;
  handleFactTogglePin: (fact: MemoryFactRow) => void;
  setFactsFilter: React.Dispatch<React.SetStateAction<string>>;
  setFactsPinnedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
};

export function FactsSection({
  colors,
  episodes,
  facts,
  factsFilter,
  factsPinnedOnly,
  handleFactCorrect,
  handleFactForget,
  handleFactTogglePin,
  setFactsFilter,
  setFactsPinnedOnly,
  styles,
  t,
}: FactsSectionProps) {
  return (
    <View style={styles.editorContainer} testID="memory-facts-tab">
      <View style={styles.factsToolbar}>
        <TextInput
          accessibilityLabel={t('memory.factsSearchPlaceholder')}
          style={styles.factsSearch}
          value={factsFilter}
          onChangeText={setFactsFilter}
          placeholder={t('memory.factsSearchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect
          returnKeyType="search"
          testID="memory-facts-search"
        />
        <View style={styles.factsToggleRow}>
          <Text style={styles.statusLine}>{t('memory.factsPinnedOnly')}</Text>
          <Switch
            accessibilityLabel={t('memory.factsPinnedOnly')}
            value={factsPinnedOnly}
            onValueChange={setFactsPinnedOnly}
            testID="memory-facts-pinned-toggle"
          />
        </View>
        <Text style={styles.statusLine}>{t('memory.factsCount', { count: facts.length })}</Text>
      </View>
      <ScrollView style={styles.editorScroll}>
        {facts.length === 0 ? (
          <Text style={styles.emptyText}>{t('memory.factsEmpty')}</Text>
        ) : (
          facts.map((fact) => (
            <MemoryFactCard
              colors={colors}
              fact={fact}
              key={fact.id}
              onCorrect={handleFactCorrect}
              onForget={handleFactForget}
              onTogglePin={handleFactTogglePin}
              t={t}
            />
          ))
        )}
        <Text style={styles.episodesTitle}>{t('memory.episodesTitle')}</Text>
        {episodes.length === 0 ? (
          <Text style={styles.emptyText}>{t('memory.episodesEmpty')}</Text>
        ) : (
          episodes.map((episode) => (
            <View key={episode.id} style={styles.factRow} testID={`memory-episode-${episode.id}`}>
              <Text style={styles.factSubject}>{episode.summary}</Text>
              <Text style={styles.factMeta}>
                {t('memory.episodeSources', {
                  count: (episode.messageIds?.length ?? 0) + (episode.toolNames?.length ?? 0),
                })}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
