// ---------------------------------------------------------------------------
// Kavi — ToolCallDisplay Component
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Wrench, Check, X, Eye } from 'lucide-react-native';
import { ToolCall } from '../../types/message';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';

interface ToolCallDisplayProps {
  toolCall: ToolCall;
  onViewFile?: (path: string) => void;
}

interface PollOption {
  id: string;
  label: string;
  votes: number;
}

interface ParsedPoll {
  question: string;
  options: PollOption[];
  allowMultiple?: boolean;
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

const StatusIcon: React.FC<{
  status: ToolCall['status'];
  color: string;
  successColor: string;
  dangerColor: string;
}> = ({ status, color, successColor, dangerColor }) => {
  switch (status) {
    case 'completed':
      return <Check size={14} color={successColor} />;
    case 'failed':
      return <X size={14} color={dangerColor} />;
    case 'running':
      return <ActivityIndicator size="small" color={color} testID="tool-call-running-indicator" />;
    default:
      return <Wrench size={14} color={color} />;
  }
};

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const WAITING_PHRASES = [
  'Monitoring progress',
  'Waiting for the next update',
  'Holding for completion',
  'Checking again soon',
];

function formatCompactDuration(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatHumanDuration(totalMs: number): string {
  const totalSeconds = Math.max(1, Math.round(totalMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function getElapsedMs(toolCall: ToolCall, now: number): number | null {
  const startedAt = toolCall.startedAt ?? toolCall.updatedAt ?? toolCall.completedAt;
  if (!startedAt) {
    return null;
  }

  const endTime =
    toolCall.status === 'pending' || toolCall.status === 'running'
      ? now
      : (toolCall.completedAt ?? toolCall.updatedAt ?? now);
  return Math.max(0, endTime - startedAt);
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickWaitingPhrase(elapsedMs: number | null): string {
  if (elapsedMs === null) {
    return WAITING_PHRASES[0];
  }
  return (
    WAITING_PHRASES[Math.floor(elapsedMs / 10000) % WAITING_PHRASES.length] || WAITING_PHRASES[0]
  );
}

function getWaitingPresentation(toolCall: ToolCall): { title: string; detail?: string } | null {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.arguments || '{}');
  } catch {
    args = {};
  }

  switch (toolCall.name) {
    case 'wait': {
      const ms = parseNumericValue(args.ms);
      const reason =
        typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : undefined;
      return {
        title: ms ? `Waiting ${formatHumanDuration(ms)}` : 'Waiting',
        detail: reason,
      };
    }
    case 'browser_wait': {
      const text = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : undefined;
      const selector =
        typeof args.selector === 'string' && args.selector.trim()
          ? args.selector.trim()
          : undefined;
      const timeMs = parseNumericValue(args.timeMs);
      if (text) {
        return { title: `Waiting for "${text}"` };
      }
      if (selector) {
        return { title: `Waiting for ${selector}` };
      }
      return {
        title: timeMs ? `Waiting ${formatHumanDuration(timeMs)}` : 'Waiting for browser state',
      };
    }
    case 'expo_eas_workflow_wait': {
      const workflowRunId =
        typeof args.workflowRunId === 'string' && args.workflowRunId.trim()
          ? args.workflowRunId.trim()
          : undefined;
      return {
        title: workflowRunId ? `Waiting on workflow ${workflowRunId}` : 'Waiting on Expo workflow',
      };
    }
    case 'sessions_wait': {
      const sessionId =
        typeof args.sessionId === 'string' && args.sessionId.trim()
          ? args.sessionId.trim()
          : undefined;
      const sessionIds = Array.isArray(args.sessionIds)
        ? args.sessionIds.filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : [];
      const waitTimeoutMs = parseNumericValue(args.waitTimeoutMs);
      const detail = waitTimeoutMs ? `Up to ${formatHumanDuration(waitTimeoutMs)}` : undefined;

      if (sessionId) {
        return { title: `Waiting on agent ${sessionId.slice(0, 12)}...`, detail };
      }
      if (sessionIds.length === 1) {
        return { title: `Waiting on agent ${sessionIds[0].slice(0, 12)}...`, detail };
      }
      if (sessionIds.length > 1) {
        return { title: `Waiting on ${sessionIds.length} agents`, detail };
      }
      return { title: 'Waiting on active agents', detail };
    }
    default:
      return toolCall.name.endsWith('_wait')
        ? { title: `Waiting on ${humanizeToolName(toolCall.name)}` }
        : null;
  }
}

function formatDisplayUrl(url: string, maxLength = 52): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, '');
    const suffix = `${parsed.pathname || ''}${parsed.search || ''}${parsed.hash || ''}`;
    const normalized = suffix && suffix !== '/' ? `${host}${suffix}` : host;
    if (normalized.length <= maxLength) {
      return normalized;
    }

    const keep = Math.max(12, maxLength - host.length - 3);
    const shortenedSuffix = suffix.slice(0, keep).replace(/\/$/, '');
    return `${host}${shortenedSuffix}...`;
  } catch {
    return url.length <= maxLength ? url : `${url.slice(0, maxLength - 3)}...`;
  }
}

export function humanizeToolName(name: string, t?: TranslateFn): string {
  const translated = t ? t(`toolCall.tools.${name}`) : `toolCall.tools.${name}`;
  if (translated && translated !== `toolCall.tools.${name}`) {
    return translated;
  }
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function translateOrFallback(
  t: TranslateFn | undefined,
  key: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  if (!t) {
    return fallback;
  }

  const translated = t(key, params);
  return translated === key ? fallback : translated;
}

export function summarizeToolCall(toolCall: ToolCall, t?: TranslateFn): string | null {
  try {
    const args = JSON.parse(toolCall.arguments || '{}');
    switch (toolCall.name) {
      case 'wait': {
        const ms = parseNumericValue(args.ms);
        return ms ? `Waiting ${formatHumanDuration(ms)}` : 'Waiting';
      }
      case 'write_file':
        return t
          ? args.path
            ? t('toolCall.summaries.writeFilePath', { path: args.path })
            : t('toolCall.summaries.writeFile')
          : args.path
            ? `Creating ${args.path}`
            : 'Creating a file';
      case 'file_edit':
        return t
          ? args.path
            ? t('toolCall.summaries.editFilePath', { path: args.path })
            : t('toolCall.summaries.editFile')
          : args.path
            ? `Editing ${args.path}`
            : 'Editing a file';
      case 'read_file':
        return t
          ? args.path
            ? t('toolCall.summaries.readFilePath', { path: args.path })
            : t('toolCall.summaries.readFile')
          : args.path
            ? `Reading ${args.path}`
            : 'Reading a file';
      case 'canvas_create':
        return t
          ? args.title
            ? t('toolCall.summaries.canvasCreateTitle', { title: args.title })
            : t('toolCall.summaries.canvasCreate')
          : args.title
            ? `Creating canvas ${args.title}`
            : 'Creating a canvas';
      case 'canvas_update':
        return t
          ? args.surfaceId
            ? t('toolCall.summaries.canvasUpdateId', { id: args.surfaceId })
            : t('toolCall.summaries.canvasUpdate')
          : args.surfaceId
            ? `Updating ${args.surfaceId}`
            : 'Updating a canvas';
      case 'canvas_read':
        return translateOrFallback(
          t,
          args.surfaceId ? 'toolCall.summaries.canvasReadId' : 'toolCall.summaries.canvasRead',
          args.surfaceId ? { id: args.surfaceId } : undefined,
          args.surfaceId ? `Reading ${args.surfaceId}` : 'Reading a canvas',
        );
      case 'canvas_navigate':
        return t
          ? args.url
            ? t('toolCall.summaries.canvasNavigateUrl', { url: formatDisplayUrl(args.url) })
            : t('toolCall.summaries.canvasNavigate')
          : args.url
            ? `Loading ${formatDisplayUrl(args.url)}`
            : 'Loading a canvas page';
      case 'canvas_snapshot':
        return translateOrFallback(
          t,
          args.surfaceId
            ? 'toolCall.summaries.canvasSnapshotId'
            : 'toolCall.summaries.canvasSnapshot',
          args.surfaceId ? { id: args.surfaceId } : undefined,
          args.surfaceId ? `Capturing ${args.surfaceId}` : 'Capturing a canvas snapshot',
        );
      case 'web_fetch':
        return t
          ? args.url
            ? t('toolCall.summaries.webFetchUrl', { url: formatDisplayUrl(args.url) })
            : t('toolCall.summaries.webFetch')
          : args.url
            ? `Fetching ${formatDisplayUrl(args.url)}`
            : 'Fetching a page';
      case 'ssh_exec':
        return t
          ? args.command
            ? t('toolCall.summaries.sshExecCommand', { command: args.command })
            : t('toolCall.summaries.sshExec')
          : args.command
            ? `Running ${args.command}`
            : 'Running a remote command';
      case 'ssh_read_file':
        return t
          ? args.path
            ? t('toolCall.summaries.sshReadFilePath', { path: args.path })
            : t('toolCall.summaries.sshReadFile')
          : args.path
            ? `Reading ${args.path}`
            : 'Reading a remote file';
      case 'ssh_write_file':
        return t
          ? args.path
            ? t('toolCall.summaries.sshWriteFilePath', { path: args.path })
            : t('toolCall.summaries.sshWriteFile')
          : args.path
            ? `Writing ${args.path}`
            : 'Writing a remote file';
      case 'ssh_list_directory':
        return t
          ? args.path
            ? t('toolCall.summaries.sshListDirectoryPath', { path: args.path })
            : t('toolCall.summaries.sshListDirectory')
          : args.path
            ? `Listing ${args.path}`
            : 'Listing a remote directory';
      // ── Session / Sub-agent tools ───────────────────────────────────
      case 'sessions_spawn': {
        const label = args.name ? `🧠 Spawning agent: ${args.name}` : '🧠 Spawning sub-agent';
        return args.waitForCompletion ? `${label} (blocking)` : label;
      }
      case 'sessions_status':
        return args.sessionId
          ? `Checking agent ${args.sessionId.slice(0, 12)}…`
          : 'Checking agent status';
      case 'sessions_list':
        return 'Listing active agents';
      case 'sessions_send': {
        const label = args.sessionId
          ? `Messaging agent ${args.sessionId.slice(0, 12)}…`
          : 'Messaging a sub-agent';
        return args.waitForCompletion ? `${label} (blocking)` : label;
      }
      case 'sessions_history':
        return args.sessionId
          ? `Reading agent ${args.sessionId.slice(0, 12)}… history`
          : 'Reading agent history';
      case 'sessions_output':
        return args.sessionId
          ? `Reading final output from agent ${args.sessionId.slice(0, 12)}…`
          : 'Reading agent final output';
      case 'sessions_surface_output':
        return args.sessionId
          ? `Surfacing output from agent ${args.sessionId.slice(0, 12)}…`
          : 'Surfacing agent output';
      case 'sessions_wait': {
        if (typeof args.sessionId === 'string' && args.sessionId.trim()) {
          return `Waiting on agent ${args.sessionId.trim().slice(0, 12)}…`;
        }
        if (Array.isArray(args.sessionIds)) {
          const sessionIds = args.sessionIds.filter(
            (value: unknown): value is string =>
              typeof value === 'string' && value.trim().length > 0,
          );
          if (sessionIds.length === 1) {
            return `Waiting on agent ${sessionIds[0].slice(0, 12)}…`;
          }
          if (sessionIds.length > 1) {
            return `Waiting on ${sessionIds.length} agents`;
          }
        }
        return 'Waiting on active agents';
      }
      case 'sessions_cancel':
        return args.sessionId
          ? `Stopping agent ${args.sessionId.slice(0, 12)}…`
          : 'Stopping a sub-agent';
      case 'sessions_yield':
        return '⏸ Recording agent checkpoint';
      default:
        return null;
    }
  } catch {
    return null;
  }
}

const ToolCallDisplayComponent: React.FC<ToolCallDisplayProps> = ({ toolCall, onViewFile }) => {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
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

  const fileToolPath = useMemo(() => {
    if (toolCall.status !== 'completed') return null;
    if (
      toolCall.name !== 'write_file' &&
      toolCall.name !== 'file_edit' &&
      toolCall.name !== 'read_file'
    )
      return null;
    try {
      const args = JSON.parse(toolCall.arguments || '{}');
      return args.path || null;
    } catch {
      return null;
    }
  }, [toolCall.name, toolCall.status, toolCall.arguments]);

  const parsedPoll = useMemo(() => {
    if (toolCall.name !== 'poll_create' || !toolCall.result) return null;
    try {
      const parsed = JSON.parse(toolCall.result);
      const poll = parsed?.poll as ParsedPoll | undefined;
      if (!poll?.question || !Array.isArray(poll.options)) return null;
      return poll;
    } catch {
      return null;
    }
  }, [toolCall.name, toolCall.result]);

  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
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

  let parsedArgs: string;
  try {
    parsedArgs = JSON.stringify(JSON.parse(toolCall.arguments), null, 2);
  } catch {
    parsedArgs = toolCall.arguments;
  }

  const togglePollOption = (optionId: string) => {
    if (!parsedPoll) return;
    setSelectedOptionIds((current) => {
      if (parsedPoll.allowMultiple) {
        return current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
      }
      return current.includes(optionId) ? [] : [optionId];
    });
  };

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
        <StatusIcon
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
      {parsedPoll && (
        <View style={styles.pollCard}>
          <Text style={styles.pollQuestion}>{parsedPoll.question}</Text>
          {parsedPoll.options.map((option) => {
            const isSelected = selectedOptionIds.includes(option.id);
            const displayedVotes = option.votes + (isSelected ? 1 : 0);
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.pollOption, isSelected && styles.pollOptionSelected]}
                onPress={() => togglePollOption(option.id)}
                accessibilityRole="button"
                accessibilityLabel={option.label}
              >
                <Text style={styles.pollOptionLabel}>{option.label}</Text>
                <Text style={styles.pollOptionVotes}>{displayedVotes}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {expanded && (
        <View style={styles.body}>
          <Text style={styles.sectionLabel}>{t('toolCall.sections.arguments')}</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText} selectable>
              {parsedArgs}
            </Text>
          </View>
          {toolCall.result && (
            <>
              <Text style={styles.sectionLabel}>{t('toolCall.sections.result')}</Text>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText} selectable numberOfLines={20}>
                  {toolCall.result}
                </Text>
              </View>
            </>
          )}
          {toolCall.error && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.danger }]}>
                {t('toolCall.sections.error')}
              </Text>
              <Text style={[styles.codeText, { color: colors.danger }]} selectable>
                {toolCall.error}
              </Text>
            </>
          )}
        </View>
      )}
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

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      backgroundColor: colors.toolCard,
      borderRadius: 8,
      marginVertical: 4,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 10,
      gap: 8,
      backgroundColor: colors.toolCardHeader,
    },
    headerTextBlock: {
      flex: 1,
      gap: 2,
    },
    toolName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    summaryText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    waitingBanner: {
      marginTop: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 7,
      backgroundColor: colors.codeBackground,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 2,
    },
    waitingTitle: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.text,
    },
    waitingDetail: {
      fontSize: 10,
      color: colors.textSecondary,
    },
    liveDetailText: {
      marginTop: 4,
      fontSize: 10,
      color: colors.textSecondary,
    },
    viewFileBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
      backgroundColor: colors.primarySoft,
    },
    viewFileBtnText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.primary,
    },
    statusText: {
      fontSize: 11,
      color: colors.textTertiary,
      textTransform: 'capitalize',
    },
    body: {
      padding: 10,
      gap: 6,
    },
    pollCard: {
      paddingHorizontal: 10,
      paddingBottom: 10,
      gap: 8,
    },
    pollQuestion: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      paddingTop: 2,
    },
    pollOption: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: colors.codeBackground,
    },
    pollOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.toolCardHeader,
    },
    pollOptionLabel: {
      color: colors.text,
      fontSize: 12,
      flex: 1,
      paddingRight: 12,
    },
    pollOptionVotes: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    codeBlock: {
      backgroundColor: colors.codeBackground,
      borderRadius: 6,
      padding: 8,
    },
    codeText: {
      fontSize: 12,
      fontFamily: 'monospace',
      color: colors.textSecondary,
      lineHeight: 17,
    },
  });
