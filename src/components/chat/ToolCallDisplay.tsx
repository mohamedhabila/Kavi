import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react-native';
import type { ToolCall } from '../../types/message';
import { useAppTheme } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';
import { redactSensitiveText } from '../../services/security/toolDetailRedaction';
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
  onViewCanvas?: () => void;
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
  if (toolName !== 'write_file' && toolName !== 'file_edit' && toolName !== 'read_file') {
    return null;
  }

  try {
    const args = JSON.parse(toolArguments || '{}');
    return args.path || null;
  } catch {
    return null;
  }
}

function hasCompletedCanvasResult(toolName: string, toolStatus: ToolCall['status']): boolean {
  if (toolStatus !== 'completed') return false;
  return ['canvas_create', 'canvas_update', 'canvas_navigate', 'canvas_snapshot'].includes(
    toolName,
  );
}

const ToolCallDisplayComponent: React.FC<ToolCallDisplayProps> = ({
  toolCall,
  onViewCanvas,
  onViewFile,
}) => {
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
  const canViewCanvas = hasCompletedCanvasResult(toolCall.name, toolCall.status);
  const parsedPoll = useMemo(
    () => parseToolCallPoll(toolCall.name, toolCall.result),
    [toolCall.name, toolCall.result],
  );
  const unsafeSummary = summarizeToolCall(toolCall, t);
  const summary = unsafeSummary ? redactSensitiveText(unsafeSummary) : null;
  const toolName = humanizeToolName(toolCall.name, t);
  const statusText = t(`toolCall.status.${toolCall.status}`);
  const elapsedMs = getElapsedMs(toolCall, now);
  const unsafeWaitingPresentation =
    toolCall.status === 'pending' || toolCall.status === 'running'
      ? getWaitingPresentation(toolCall)
      : null;
  const waitingPresentation = unsafeWaitingPresentation
    ? {
        title: redactSensitiveText(unsafeWaitingPresentation.title),
        detail: unsafeWaitingPresentation.detail
          ? redactSensitiveText(unsafeWaitingPresentation.detail)
          : undefined,
      }
    : null;
  const displayTitle = waitingPresentation?.title || summary || toolName;
  const isActive = toolCall.status === 'pending' || toolCall.status === 'running';
  const isFinished = toolCall.status === 'completed' || toolCall.status === 'failed';
  const unsafeRunningDetailText =
    toolCall.progressText ||
    (elapsedMs !== null && isActive ? `${formatCompactDuration(elapsedMs)} elapsed` : null);
  const runningDetailText = unsafeRunningDetailText
    ? redactSensitiveText(unsafeRunningDetailText)
    : null;
  const completedDurationText =
    isFinished && elapsedMs !== null && elapsedMs >= 500 ? formatHumanDuration(elapsedMs) : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.disclosureButton}
          onPress={() => setExpanded((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={t('toolCall.accessibilityLabel', {
            name: displayTitle,
            status: statusText,
          })}
          accessibilityHint={
            expanded ? t('toolCall.collapseDetailsHint') : t('toolCall.expandDetailsHint')
          }
          accessibilityState={{ expanded }}
          testID={`tool-call-disclosure-${toolCall.id}`}
        >
          <ToolCallStatusIcon
            status={toolCall.status}
            color={colors.textTertiary}
            successColor={colors.success}
            dangerColor={colors.danger}
          />
          <View style={styles.headerTextBlock}>
            <Text style={styles.toolName}>{displayTitle}</Text>
            {waitingPresentation ? (
              <View style={styles.waitingBanner} testID="tool-call-waiting-banner">
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
          <View style={styles.disclosureStatus}>
            <Text style={styles.statusText} numberOfLines={1}>
              {completedDurationText ? `${statusText} · ${completedDurationText}` : statusText}
            </Text>
            {expanded ? (
              <ChevronDown size={18} color={colors.textTertiary} />
            ) : (
              <ChevronRight size={18} color={colors.textTertiary} />
            )}
          </View>
        </TouchableOpacity>
        {fileToolPath && onViewFile ? (
          <TouchableOpacity
            style={styles.viewResultBtn}
            onPress={() => onViewFile(fileToolPath)}
            accessibilityRole="button"
            accessibilityLabel={t('toolCall.viewFile', {
              path: redactSensitiveText(fileToolPath),
            })}
            accessibilityHint={t('toolCall.viewFileHint')}
            testID={`tool-call-view-file-${toolCall.id}`}
          >
            <Eye size={18} color={colors.primary} />
            <Text style={styles.viewResultBtnText}>{t('common.view')}</Text>
          </TouchableOpacity>
        ) : canViewCanvas && onViewCanvas ? (
          <TouchableOpacity
            style={styles.viewResultBtn}
            onPress={onViewCanvas}
            accessibilityRole="button"
            accessibilityLabel={t('toolCall.viewCanvas')}
            accessibilityHint={t('toolCall.viewCanvasHint')}
            testID={`tool-call-view-canvas-${toolCall.id}`}
          >
            <Eye size={18} color={colors.primary} />
            <Text style={styles.viewResultBtnText}>{t('common.view')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {parsedPoll ? <ToolCallPoll poll={parsedPoll} styles={styles} /> : null}
      {expanded ? (
        <ToolCallBody toolCall={toolCall} styles={styles} iconColor={colors.textSecondary} t={t} />
      ) : null}
    </View>
  );
};

export const ToolCallDisplay = React.memo(
  ToolCallDisplayComponent,
  (previousProps, nextProps) =>
    previousProps.onViewCanvas === nextProps.onViewCanvas &&
    previousProps.onViewFile === nextProps.onViewFile &&
    buildToolCallRenderSignature(previousProps.toolCall) ===
      buildToolCallRenderSignature(nextProps.toolCall),
);

ToolCallDisplay.displayName = 'ToolCallDisplay';
