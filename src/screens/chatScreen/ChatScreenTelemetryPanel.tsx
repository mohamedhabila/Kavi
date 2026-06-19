import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { getUsageCacheSummary } from '../../services/usage/tracker';
import type { Conversation } from '../../types/conversation';
import {
  formatConversationLogTime,
  formatLogKindLabel,
  formatTokenCount,
  formatUsdCost,
} from '../chatFormatting';
import { createStyles } from '../ChatScreen.styles';
import type { AppPalette } from '../../theme/useAppTheme';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatScreenTelemetryPanelProps = {
  activeConversation?: Conversation;
  colors: AppPalette;
  onToggleLogs: () => void;
  showLogs: boolean;
  styles: ReturnType<typeof createStyles>;
  t: TranslationFn;
};

export function ChatScreenTelemetryPanel(props: ChatScreenTelemetryPanelProps) {
  const usageSummary = props.activeConversation?.usage;
  const usageTotals = {
    totalTokens: usageSummary?.totalTokens ?? 0,
    totalInput: usageSummary?.totalInput ?? 0,
    totalOutput: usageSummary?.totalOutput ?? 0,
    totalCacheRead: usageSummary?.totalCacheRead ?? 0,
    totalCacheWrite: usageSummary?.totalCacheWrite ?? 0,
    totalCost: usageSummary?.totalCost ?? 0,
    totalCalls: usageSummary?.totalCalls ?? 0,
  };
  const usageCacheSummary = getUsageCacheSummary({
    inputTokens: usageTotals.totalInput,
    cacheReadTokens: usageTotals.totalCacheRead,
    cacheWriteTokens: usageTotals.totalCacheWrite,
  });
  const conversationLogs = props.activeConversation?.logs;
  const visibleConversationLogs = useMemo(
    () => [...(conversationLogs ?? [])].reverse(),
    [conversationLogs],
  );
  const usageDetailText =
    usageTotals.totalCalls > 0
      ? `In ${formatTokenCount(usageTotals.totalInput)} · Out ${formatTokenCount(usageTotals.totalOutput)} · ${props.t('chat.usageCache')} ${formatTokenCount(usageCacheSummary.cacheReadTokens)} / ${formatTokenCount(usageCacheSummary.cacheDenominatorTokens)}${usageCacheSummary.cacheWriteTokens > 0 ? ` · write ${formatTokenCount(usageCacheSummary.cacheWriteTokens)}` : ''}`
      : props.t('chat.noUsageYet');

  if (!props.activeConversation) {
    return null;
  }

  return (
    <>
      <View style={props.styles.telemetryCard} testID="chat-usage-strip">
        <View style={props.styles.telemetryRow}>
          <View style={props.styles.telemetryMetric}>
            <Text style={props.styles.telemetryLabel}>{props.t('chat.usageTokens')}</Text>
            <Text style={props.styles.telemetryValue}>
              {formatTokenCount(usageTotals.totalTokens)}
            </Text>
          </View>
          <View style={props.styles.telemetryMetric}>
            <Text style={props.styles.telemetryLabel}>{props.t('chat.usageCost')}</Text>
            <Text style={props.styles.telemetryValue}>{formatUsdCost(usageTotals.totalCost)}</Text>
          </View>
          <View style={props.styles.telemetryMetric}>
            <Text style={props.styles.telemetryLabel}>{props.t('chat.usageCalls')}</Text>
            <Text style={props.styles.telemetryValue}>{String(usageTotals.totalCalls)}</Text>
          </View>
        </View>

        <View style={props.styles.telemetryFooter}>
          <Text style={props.styles.telemetryMeta} numberOfLines={2}>
            {usageDetailText}
          </Text>
          <TouchableOpacity
            testID="chat-logs-toggle"
            style={props.styles.logsToggle}
            onPress={props.onToggleLogs}
            accessibilityRole="button"
            accessibilityLabel={
              props.showLogs ? props.t('chat.hideLogs') : props.t('chat.showLogs')
            }
          >
            <Text style={props.styles.logsToggleText}>
              {props.showLogs ? props.t('chat.hideLogs') : props.t('chat.showLogs')}
            </Text>
            <View style={props.styles.logsToggleBadge}>
              <Text style={props.styles.logsToggleBadgeText}>
                {String((conversationLogs ?? []).length)}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {props.showLogs ? (
        <View style={props.styles.logsPanel} testID="chat-logs-panel">
          <View style={props.styles.logsHeader}>
            <Text style={props.styles.logsTitle}>{props.t('chat.latestLogs')}</Text>
            <Text
              style={props.styles.logsCount}
            >{`${visibleConversationLogs.length}/${(conversationLogs ?? []).length}`}</Text>
          </View>

          {visibleConversationLogs.length > 0 ? (
            <ScrollView
              testID="chat-logs-scroll"
              style={props.styles.logsScroll}
              contentContainerStyle={props.styles.logsScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {visibleConversationLogs.map((entry) => {
                const accentColor =
                  entry.level === 'error'
                    ? props.colors.danger
                    : entry.level === 'success'
                      ? props.colors.primary
                      : props.colors.textSecondary;

                return (
                  <View key={entry.id} style={props.styles.logEntry}>
                    <View style={props.styles.logMetaRow}>
                      <View style={[props.styles.logKindBadge, { borderColor: accentColor }]}>
                        <Text style={[props.styles.logKindText, { color: accentColor }]}>
                          {formatLogKindLabel(entry.kind)}
                        </Text>
                      </View>
                      <Text style={props.styles.logTimestamp}>
                        {formatConversationLogTime(entry.timestamp)}
                      </Text>
                    </View>
                    <Text style={props.styles.logTitle}>{entry.title}</Text>
                    {entry.detail ? (
                      <Text style={props.styles.logDetail}>{entry.detail}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={props.styles.logsEmpty}>{props.t('chat.logsEmpty')}</Text>
          )}
        </View>
      ) : null}
    </>
  );
}
