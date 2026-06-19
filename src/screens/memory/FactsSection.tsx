import React from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Pin, PinOff, Trash2 } from 'lucide-react-native';

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
  handleFactForget: (fact: MemoryFactRow) => void;
  handleFactToggleStar: (fact: MemoryFactRow) => void;
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
  handleFactForget,
  handleFactToggleStar,
  setFactsFilter,
  setFactsPinnedOnly,
  styles,
  t,
}: FactsSectionProps) {
  return (
    <View style={styles.editorContainer} testID="memory-facts-tab">
      <View style={styles.factsToolbar}>
        <TextInput
          style={styles.factsSearch}
          value={factsFilter}
          onChangeText={setFactsFilter}
          placeholder={t('memory.factsSearchPlaceholder')}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          testID="memory-facts-search"
        />
        <View style={styles.factsToggleRow}>
          <Text style={styles.statusLine}>{t('memory.factsPinnedOnly')}</Text>
          <Switch
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
            <View key={fact.id} style={styles.factRow} testID={`memory-fact-${fact.id}`}>
              <Text style={styles.factSubject}>
                {fact.subject} · {fact.predicate}
              </Text>
              <Text style={styles.factValue}>{fact.value}</Text>
              <Text style={styles.factMeta}>
                {t('memory.factMetaPrimary', {
                  scope: fact.scope,
                  confidence: Math.round(fact.confidence * 100),
                  importance: Math.round(fact.importance * 100),
                })}
              </Text>
              <Text style={styles.factMeta}>
                {fact.originConversationId
                  ? t('memory.factSourceConversation', { id: fact.originConversationId })
                  : t('memory.factSourceGlobal')}
                {fact.lastRecalledAt
                  ? ` ${t('memory.factLastRecalled', {
                      date: new Date(fact.lastRecalledAt).toLocaleDateString(),
                    })}`
                  : ''}
              </Text>
              <View style={styles.factActions}>
                <TouchableOpacity
                  onPress={() => handleFactToggleStar(fact)}
                  accessibilityLabel={fact.pinned ? t('memory.factUnpin') : t('memory.factPin')}
                  testID={`memory-fact-pin-${fact.id}`}
                >
                  {fact.pinned ? (
                    <PinOff size={16} color={colors.primary} />
                  ) : (
                    <Pin size={16} color={colors.textSecondary} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleFactForget(fact)}
                  accessibilityLabel={t('memory.factForget')}
                  testID={`memory-fact-forget-${fact.id}`}
                >
                  <Trash2 size={16} color={colors.danger} />
                </TouchableOpacity>
              </View>
            </View>
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
