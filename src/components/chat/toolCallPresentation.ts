import type { ToolCall } from '../../types/message';

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

const WAITING_PHRASES = [
  'Monitoring progress',
  'Waiting for the next update',
  'Holding for completion',
  'Checking again soon',
];

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

export function formatCompactDuration(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatHumanDuration(totalMs: number): string {
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

export function getElapsedMs(toolCall: ToolCall, now: number): number | null {
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

export function pickWaitingPhrase(elapsedMs: number | null): string {
  if (elapsedMs === null) {
    return WAITING_PHRASES[0];
  }
  return (
    WAITING_PHRASES[Math.floor(elapsedMs / 10000) % WAITING_PHRASES.length] || WAITING_PHRASES[0]
  );
}

export function getWaitingPresentation(toolCall: ToolCall): { title: string; detail?: string } | null {
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
