import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import type { MemoryScreenStyles, MemoryScreenTranslation } from './memoryScreenTypes';

type DailySectionProps = {
  dailyContent: string;
  dailyFiles: string[];
  loadDailyContent: (date: string) => Promise<void>;
  memoryStatus: string;
  selectedDate: string | null;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
};

export function DailySection({
  dailyContent,
  dailyFiles,
  loadDailyContent,
  memoryStatus,
  selectedDate,
  styles,
  t,
}: DailySectionProps) {
  return (
    <ScrollView style={styles.dailyContainer}>
      <Text style={styles.statusLine}>{memoryStatus}</Text>
      {dailyFiles.length === 0 ? (
        <Text style={styles.emptyText}>{t('memory.noDailyFiles')}</Text>
      ) : (
        <>
          <View style={styles.dateList}>
            {dailyFiles.map((date) => (
              <TouchableOpacity
                key={date}
                style={[styles.dateChip, selectedDate === date && styles.dateChipActive]}
                onPress={() => void loadDailyContent(date)}
              >
                <Text
                  style={[styles.dateChipText, selectedDate === date && styles.dateChipTextActive]}
                >
                  {date}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {selectedDate ? (
            <View style={styles.dailyViewer}>
              <Text style={styles.dailyHeader}>{selectedDate}</Text>
              <Text style={styles.dailyBody}>{dailyContent}</Text>
            </View>
          ) : (
            <Text style={styles.emptyText}>{t('memory.selectDate')}</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
