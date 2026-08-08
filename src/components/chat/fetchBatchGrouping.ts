import type { ToolCall } from '../../types/message';

/**
 * Collapses a run of page fetches into one item so the transcript reads as work rather
 * than as a wall of identical rows.
 *
 * A research turn issues a dozen or more `web_fetch` calls, and each rendered as its own
 * card. Traced on-device, a twelve-source request filled the transcript with near
 * identical "Fetching a page" rows, several of them failed URLs, and the one thing a
 * reader wants — which pages are being read, and how far along it is — was the one thing
 * not shown.
 *
 * Only consecutive fetches are grouped, so a batch never swallows the write or the goal
 * update that followed it and the transcript keeps its real order. A lone fetch is left
 * as an ordinary row: a group of one is just a card with extra chrome.
 */

export const WEB_FETCH_TOOL_NAME = 'web_fetch';

/** Minimum consecutive fetches before collapsing is worth the indirection. */
export const MIN_GROUPED_FETCHES = 2;

export type FetchBatchTarget = {
  toolCallId: string;
  url?: string;
  host?: string;
  status: ToolCall['status'];
};

export type AssistantToolCallGroup =
  | { kind: 'single'; toolCall: ToolCall }
  | { kind: 'fetch_batch'; toolCalls: ToolCall[]; targets: FetchBatchTarget[] };

/** The first URL a `web_fetch` call was given, when its arguments parse. */
export function readFetchCallUrl(toolCall: ToolCall): string | undefined {
  try {
    const parsed = JSON.parse(toolCall.arguments || '{}') as {
      urls?: unknown;
      url?: unknown;
    };
    const candidate = Array.isArray(parsed.urls) ? parsed.urls[0] : (parsed.urls ?? parsed.url);
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Host of `url`, for a compact label, without throwing on a malformed value. */
export function readUrlHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(/^[a-z]+:\/\/([^/?#]+)/i);
  const host = match?.[1];
  if (!host) return undefined;
  return host.replace(/^www\./i, '').toLowerCase() || undefined;
}

function toTarget(toolCall: ToolCall): FetchBatchTarget {
  const url = readFetchCallUrl(toolCall);
  return {
    toolCallId: toolCall.id,
    ...(url ? { url } : {}),
    ...(readUrlHost(url) ? { host: readUrlHost(url) } : {}),
    status: toolCall.status,
  };
}

export function groupAssistantToolCalls(
  toolCalls: ReadonlyArray<ToolCall> | undefined,
): AssistantToolCallGroup[] {
  if (!toolCalls?.length) {
    return [];
  }

  const groups: AssistantToolCallGroup[] = [];
  let run: ToolCall[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length < MIN_GROUPED_FETCHES) {
      groups.push({ kind: 'single', toolCall: run[0]! });
    } else {
      groups.push({ kind: 'fetch_batch', toolCalls: run, targets: run.map(toTarget) });
    }
    run = [];
  };

  for (const toolCall of toolCalls) {
    if (toolCall.name === WEB_FETCH_TOOL_NAME) {
      run.push(toolCall);
      continue;
    }
    flush();
    groups.push({ kind: 'single', toolCall });
  }
  flush();

  return groups;
}

export type FetchBatchProgress = {
  total: number;
  settled: number;
  failed: number;
  active: boolean;
};

export function summarizeFetchBatch(targets: ReadonlyArray<FetchBatchTarget>): FetchBatchProgress {
  const settled = targets.filter(
    (target) => target.status === 'completed' || target.status === 'failed',
  ).length;
  return {
    total: targets.length,
    settled,
    failed: targets.filter((target) => target.status === 'failed').length,
    active: settled < targets.length,
  };
}
