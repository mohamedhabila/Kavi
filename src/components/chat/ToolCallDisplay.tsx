import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react-native';
import type { ToolCall } from '../../types/message';
import { useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { createToolCallDisplayStyles } from './ToolCallDisplay.styles';
import { ToolCallBody } from './ToolCallBody';
import { parseToolCallPoll, ToolCallPoll } from './ToolCallPoll';
import { ToolCallStatusIcon } from './ToolCallStatusIcon';
import {
  formatCompactDuration,
  formatHumanDuration,
  getElapsedMs,
  getWaitingPresentation,
  humanizeToolName,
  pickWaitingPhrase,
  summarizeToolCall,
} from './toolCallPresentation';

export { humanizeToolName, summarizeToolCall };

interface ToolCallDisplayProps {
  toolCall: ToolCall;
  onViewFile?: (path: string) => void;
}

function buildToolCallRenderSignature(toolCall: ToolCall): string {
  return [
    toolCall.id,
    toolCall.name,
    toolCall.status,
    toolCall.arguments,
    toolCall.startedAt ?? '',
    toolCall.updatedAt ?? '',
    toolCall.completedAt ?? '',
    toolCall.progressText ?? '',
    toolCall.result ?? '',
    toolCall.error ?? '',
  ].join('\u0001');
}

function getCompletedFileToolPath(
  toolName: string,
  toolStatus: ToolCall['status'],
  toolArguments: string,
): string | null {
  if (toolStatus !== 'completed') return null;
  if (
    toolName !== 'write_file' &&
    toolName !== 'file_edit' &&
    toolName !== 'read_file'
  ) {
    return null;
  }

  try {
    const args = JSON.parse(toolArguments || '{}');
    return args.path || null;
  } catch {
    return null;
  }
}

function formatToolArguments(toolArguments: string): string {
  try {
    return JSON.stringify(JSON.parse(toolArguments), null, 2);
  } catch {
    return toolArguments;
  }
}

const ToolCallDisplayComponent: React.FC<ToolCallDisplayProps> = ({ toolCall, onViewFile }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createToolCallDisplayStyles(colors);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (toolCall.status !== 'pending' && toolCall.status !== 'running') {
      return undefined;
    }

    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, [toolCall.id, toolCall.status]);

  const fileToolPath = useMemo(
    () => getCompletedFileToolPath(toolCall.name, toolCall.status, toolCall.arguments),
    [toolCall.name, toolCall.status, toolCall.arguments],
  );
  const parsedPoll = useMemo(
    () => parseToolCallPoll(toolCall.name, toolCall.result),
    [toolCall.name, toolCall.result],
  );
  const parsedArgs = useMemo(() => formatToolArguments(toolCall.arguments), [toolCall.arguments]);
  const summary = summarizeToolCall(toolCall, t);
  const toolName = humanizeToolName(toolCall.name, t);
  const statusText = t(`toolCall.status.${toolCall.status}`);
  const elapsedMs = getElapsedMs(toolCall, now);
  const waitingPresentation =
    toolCall.status === 'pending' || toolCall.status === 'running'
      ? getWaitingPresentation(toolCall)
      : null;
  const isActive = toolCall.status === 'pending' || toolCall.status === 'running';
  const isFinished = toolCall.status === 'completed' || toolCall.status === 'failed';
  const runningDetailText =
    toolCall.progressText ||
    (elapsedMs !== null && isActive ? `${formatCompactDuration(elapsedMs)} elapsed` : null);
  const completedDurationText =
    isFinished && elapsedMs !== null && elapsedMs >= 500 ? formatHumanDuration(elapsedMs) : null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityLabel={t('toolCall.accessibilityLabel', {
          name: toolName,
          status: statusText,
        })}
      >
        <ToolCallStatusIcon
          status={toolCall.status}
          color={colors.textTertiary}
          successColor={colors.success}
          dangerColor={colors.danger}
        />
        <View style={styles.headerTextBlock}>
          <Text style={styles.toolName}>{toolName}</Text>
          {summary ? (
            <Text style={styles.summaryText} numberOfLines={1} ellipsizeMode="middle">
              {summary}
            </Text>
          ) : null}
          {waitingPresentation ? (
            <View style={styles.waitingBanner} testID="tool-call-waiting-banner">
              <Text style={styles.waitingTitle}>{waitingPresentation.title}</Text>
              <Text style={styles.waitingDetail} numberOfLines={2}>
                {[pickWaitingPhrase(elapsedMs), runningDetailText, waitingPresentation.detail]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            </View>
          ) : runningDetailText ? (
            <Text style={styles.liveDetailText} numberOfLines={1}>
              {runningDetailText}
            </Text>
          ) : null}
        </View>
        {fileToolPath && onViewFile ? (
          <TouchableOpacity
            style={styles.viewFileBtn}
            onPress={() => onViewFile(fileToolPath)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('toolCall.viewFile', { path: fileToolPath })}
          >
            <Eye size={13} color={colors.primary} />
            <Text style={styles.viewFileBtnText}>{t('common.view')}</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={styles.statusText}>
          {completedDurationText ? `${statusText} · ${completedDurationText}` : statusText}
        </Text>
        {expanded ? (
          <ChevronDown size={14} color={colors.textTertiary} />
        ) : (
          <ChevronRight size={14} color={colors.textTertiary} />
        )}
      </TouchableOpacity>
      {parsedPoll ? <ToolCallPoll poll={parsedPoll} styles={styles} /> : null}
      {expanded ? (
        <ToolCallBody
          toolCall={toolCall}
          parsedArgs={parsedArgs}
          styles={styles}
          dangerColor={colors.danger}
          t={t}
        />
      ) : null}
    </View>
  );
};

export const ToolCallDisplay = React.memo(
  ToolCallDisplayComponent,
  (previousProps, nextProps) =>
    previousProps.onViewFile === nextProps.onViewFile &&
    buildToolCallRenderSignature(previousProps.toolCall) ===
      buildToolCallRenderSignature(nextProps.toolCall),
);

ToolCallDisplay.displayName = 'ToolCallDisplay';
