import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp, Shield, Trash2 } from 'lucide-react-native';

import { MemoryDiagnosticsPanel } from '../../components/memory/MemoryDiagnosticsPanel';
import { consolidationTierLabel } from './consolidationStatusLabel';
import type {
  MemoryDiagnostics,
  MemoryOverview,
  MemoryScreenPalette,
  MemoryScreenStyles,
  MemoryScreenTranslation,
} from './memoryScreenTypes';

type AdvancedSectionProps = {
  colors: MemoryScreenPalette;
  diagnostics: MemoryDiagnostics | null;
  diagnosticsError: boolean;
  diagnosticsExpanded: boolean;
  diagnosticsLoading: boolean;
  handleClearAll: () => void;
  memoryStatus: string;
  onToggleDiagnostics: () => void;
  overview: MemoryOverview | null;
  styles: MemoryScreenStyles;
  t: MemoryScreenTranslation;
};

export function AdvancedSection(props: AdvancedSectionProps) {
  return (
    <View style={props.styles.editorContainer} testID="memory-advanced-tab-panel">
      <ScrollView contentContainerStyle={props.styles.advancedContent}>
        <Text style={props.styles.overviewSectionTitle}>
          {props.t('memory.advancedStatusTitle')}
        </Text>
        <Text style={props.styles.statusLine}>{props.memoryStatus}</Text>
        {props.overview ? (
          <>
            <Text style={props.styles.overviewBody} testID="memory-advanced-consolidation">
              {consolidationTierLabel(props.overview.consolidation, props.t)}
              {props.overview.consolidation.isFallback &&
              !props.overview.consolidation.memoryDisabled
                ? ` · ${props.t('memory.consolidationFallbackActive')}`
                : ''}
            </Text>
            {props.overview.pendingIngestionJobs > 0 ? (
              <Text style={props.styles.statusLine} testID="memory-advanced-ingestion-pending">
                {props.t('memory.ingestionPendingJobs', {
                  count: props.overview.pendingIngestionJobs,
                })}
              </Text>
            ) : null}
          </>
        ) : null}

        <View style={props.styles.advancedCard}>
          <Text style={props.styles.overviewSectionTitle}>
            {props.t('memory.diagnosticsTitle')}
          </Text>
          <Text style={props.styles.overviewBody}>{props.t('memory.diagnosticsHint')}</Text>
          <TouchableOpacity
            accessibilityLabel={
              props.diagnosticsExpanded
                ? props.t('memory.hideDiagnostics')
                : props.t('memory.showDiagnostics')
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: props.diagnosticsExpanded }}
            onPress={props.onToggleDiagnostics}
            style={props.styles.advancedToggle}
            testID="memory-diagnostics-toggle"
          >
            <Text style={props.styles.advancedToggleText}>
              {props.diagnosticsExpanded
                ? props.t('memory.hideDiagnostics')
                : props.t('memory.showDiagnostics')}
            </Text>
            {props.diagnosticsExpanded ? (
              <ChevronUp size={20} color={props.colors.textSecondary} />
            ) : (
              <ChevronDown size={20} color={props.colors.textSecondary} />
            )}
          </TouchableOpacity>
          {props.diagnosticsExpanded ? (
            <View style={props.styles.advancedDetails} testID="memory-diagnostics-details">
              {props.diagnosticsLoading ? (
                <View style={props.styles.advancedLoadingRow}>
                  <ActivityIndicator color={props.colors.primary} />
                  <Text style={props.styles.statusLine}>
                    {props.t('memory.diagnosticsLoading')}
                  </Text>
                </View>
              ) : props.diagnosticsError || !props.diagnostics ? (
                <Text style={props.styles.emptyInline}>
                  {props.t('memory.diagnosticsUnavailable')}
                </Text>
              ) : (
                <MemoryDiagnosticsPanel diagnostics={props.diagnostics} showTitle={false} />
              )}
            </View>
          ) : null}
        </View>

        <View style={props.styles.advancedCard}>
          <View style={props.styles.advancedCardTitleRow}>
            <Shield size={20} color={props.colors.primary} />
            <Text style={props.styles.advancedCardTitle}>{props.t('memory.privacyTitle')}</Text>
          </View>
          <Text style={props.styles.overviewBody}>{props.t('memory.clearConfirm')}</Text>
          <TouchableOpacity
            accessibilityLabel={props.t('memory.clearAction')}
            accessibilityRole="button"
            onPress={props.handleClearAll}
            style={props.styles.clearMemoryButton}
            testID="memory-clear-all"
          >
            <Trash2 size={18} color={props.colors.danger} />
            <Text style={props.styles.clearMemoryButtonText}>{props.t('memory.clearAction')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
