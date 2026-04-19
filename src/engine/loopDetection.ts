// ---------------------------------------------------------------------------
// Kavi — Advanced Loop Detection
// ---------------------------------------------------------------------------
// Implements: global_circuit_breaker, known_poll_no_progress, ping_pong, generic_repeat.
// Uses sliding window history, result hashing for no-progress detection,
// and warning/critical severity levels for loop scoring.

import { isToolResultErrorLike } from '../utils/toolResultErrors';

export interface ToolCallRecord {
  name: string;
  arguments: string;
  timestamp: number;
  result?: string;
  argsHash?: string;
  resultHash?: string;
}

export type LoopSeverity = 'warning' | 'critical';
export type LoopDetectorKind =
  | 'generic_repeat'
  | 'known_poll_no_progress'
  | 'repeated_error'
  | 'global_circuit_breaker'
  | 'ping_pong';

export interface LoopDetectionResult {
  loopDetected: boolean;
  level?: LoopSeverity;
  type?: LoopDetectorKind;
  details?: string;
  count?: number;
}

export interface LoopDetectionContext {
  pendingAsyncOperationToolNames?: Iterable<string>;
}

// ── Constants (tuned for mobile's MAX_TOOL_ITERATIONS = 25) ───────────
// Previous values (4/8/15) were too aggressive and triggered on legitimate
// multi-step work. Raised to give the agent more room while still catching
// genuine loops before hitting the iteration limit.

export const TOOL_CALL_HISTORY_SIZE = 30;
export const WARNING_THRESHOLD = 6;
export const CRITICAL_THRESHOLD = 12;
export const GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 20;
export const ERROR_WARNING_THRESHOLD = 2;
export const ERROR_CRITICAL_THRESHOLD = 3;

const TOOL_SPECIFIC_NO_PROGRESS_THRESHOLDS: Record<
  string,
  {
    warning: number;
    critical: number;
    guidance: string;
  }
> = {
  expo_eas_list_projects: {
    warning: 2,
    critical: 3,
    guidance:
      'Reuse the returned project id/fullName, or call expo_eas_list_projects again only when you need refresh=true or a different account.',
  },
  tool_catalog: {
    warning: 2,
    critical: 3,
    guidance:
      'Use one of the discovered tools next, or choose a different category. Repeating tool_catalog with the same category will not produce a better result.',
  },
  list_files: {
    warning: 2,
    critical: 3,
    guidance:
      'Reuse the directory listing you already have. If it is empty, report that the current conversation workspace is empty instead of listing it again.',
  },
  glob_search: {
    warning: 2,
    critical: 3,
    guidance:
      'Reuse the search result you already have. If it returned no matches, report that the current conversation workspace has no matching files instead of repeating the same search.',
  },
  sessions_spawn: {
    warning: 2,
    critical: 3,
    guidance:
      'A plan-linked workstream should be read with sessions_output, refined with sessions_send, or inspected with sessions_status instead of spawning the same step again.',
  },
  sessions_list: {
    warning: 2,
    critical: 3,
    guidance:
      'Reuse the returned session ids and switch to sessions_status or sessions_history instead of listing sessions again.',
  },
};

const ASYNC_MONITOR_TOOL_NAMES = new Set([
  'wait',
  'sessions_status',
  'sessions_wait',
  'ssh_background_job_status',
  'ssh_background_job_wait',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
]);

function normalizeToolNameKey(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function trimText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractSingleTerminalWorkstreamWaitSummary(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payload) {
    return undefined;
  }

  const sessions = Array.isArray(payload.sessions) ? payload.sessions : undefined;
  if (!sessions || sessions.length !== 1) {
    return undefined;
  }

  const session = sessions[0];
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return undefined;
  }

  const sessionRecord = session as Record<string, unknown>;
  const workstreamId = trimText(sessionRecord.workstreamId);
  const sessionStatus = trimText(sessionRecord.status);
  if (!workstreamId || !sessionStatus || sessionStatus === 'running') {
    return undefined;
  }

  const artifactCount =
    typeof sessionRecord.artifactCount === 'number' ? sessionRecord.artifactCount : undefined;
  const toolsUsed = Array.isArray(sessionRecord.toolsUsed)
    ? sessionRecord.toolsUsed.filter(
        (toolName): toolName is string =>
          typeof toolName === 'string' && toolName.trim().length > 0,
      )
    : [];

  return {
    workstreamId,
    status: sessionStatus,
    hasOutput: sessionRecord.hasOutput === true,
    outputTruncated: sessionRecord.outputTruncated === true,
    ...(artifactCount !== undefined ? { artifactCount } : {}),
    ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
  };
}

function getExpectedAsyncMonitorToolNames(context?: LoopDetectionContext): Set<string> {
  const expectedMonitorTools = new Set<string>();

  for (const toolName of context?.pendingAsyncOperationToolNames ?? []) {
    const normalizedToolName = normalizeToolNameKey(toolName);
    if (ASYNC_MONITOR_TOOL_NAMES.has(normalizedToolName)) {
      expectedMonitorTools.add(normalizedToolName);
    }
  }

  return expectedMonitorTools;
}

function filterHistoryForExpectedAsyncMonitorTools(
  history: ToolCallRecord[],
  excludedToolNames: ReadonlySet<string>,
): ToolCallRecord[] {
  if (excludedToolNames.size === 0) {
    return history;
  }

  return history.filter((entry) => !excludedToolNames.has(normalizeToolNameKey(entry.name)));
}

// ── Hash helpers (no Node crypto on React Native) ────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Lightweight djb2 hash on stable-stringified params */
function simpleHash(s: string): string {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function hashToolCall(toolName: string, params: unknown): string {
  try {
    return `${toolName}:${simpleHash(stableStringify(params))}`;
  } catch {
    return `${toolName}:${simpleHash(String(params))}`;
  }
}

export function hashResult(result: string | undefined): string | undefined {
  if (result === undefined) return undefined;
  return simpleHash(result);
}

function buildCanonicalToolArgsKey(
  toolName: string,
  argsString: string,
  result?: string,
): string | undefined {
  const normalizedToolName = normalizeToolNameKey(toolName);

  if (normalizedToolName === 'sessions_spawn') {
    const args = parseJsonRecord(argsString);
    const workstreamId = trimText(args?.workstreamId);
    if (workstreamId) {
      return stableStringify({ tool: normalizedToolName, workstreamId });
    }

    return undefined;
  }

  if (normalizedToolName === 'sessions_wait') {
    const waitSummary = extractSingleTerminalWorkstreamWaitSummary(parseJsonRecord(result));
    if (waitSummary) {
      return stableStringify({ tool: normalizedToolName, ...waitSummary });
    }
  }

  return undefined;
}

function buildCanonicalToolResultHash(
  toolName: string,
  result: string | undefined,
): string | undefined {
  if (result === undefined) {
    return undefined;
  }

  const normalizedToolName = normalizeToolNameKey(toolName);

  if (normalizedToolName === 'sessions_spawn') {
    const payload = parseJsonRecord(result);
    const status = trimText(payload?.status);
    const workstreamId = trimText(payload?.workstreamId);
    const reason = trimText(payload?.reason);

    if (status && workstreamId) {
      return hashResult(
        stableStringify({
          tool: normalizedToolName,
          status,
          workstreamId,
          ...(reason ? { reason } : {}),
        }),
      );
    }
  }

  if (normalizedToolName === 'sessions_wait') {
    const waitSummary = extractSingleTerminalWorkstreamWaitSummary(parseJsonRecord(result));
    if (waitSummary) {
      return hashResult(stableStringify({ tool: normalizedToolName, ...waitSummary }));
    }
  }

  return hashResult(result);
}

function getToolCallArgsKey(
  entry: Pick<ToolCallRecord, 'name' | 'arguments' | 'argsHash' | 'result'>,
): string {
  return (
    buildCanonicalToolArgsKey(entry.name, entry.arguments, entry.result) ??
    entry.argsHash ??
    `${entry.name}::${entry.arguments}`
  );
}

function getToolCallResultKey(
  entry: Pick<ToolCallRecord, 'name' | 'result' | 'resultHash'>,
): string | undefined {
  return buildCanonicalToolResultHash(entry.name, entry.result) ?? entry.resultHash;
}

function isErrorLikeResult(result: string | undefined): boolean {
  return isToolResultErrorLike(result);
}

// ── Individual detectors ─────────────────────────────────────────────────

/**
 * Detect generic repeat: same tool + same args N times
 */
export function detectGenericRepeat(
  history: ToolCallRecord[],
  threshold: number = 3,
): { detected: boolean; tool?: string; count?: number } {
  const counts = new Map<string, number>();
  for (const h of history) {
    const key = getToolCallArgsKey(h);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count >= threshold) {
      return { detected: true, tool: h.name, count };
    }
  }
  return { detected: false };
}

/**
 * Detect ping-pong: alternating A→B→A→B pattern
 */
export function detectPingPong(
  history: ToolCallRecord[],
  minCycles: number = 2,
): { detected: boolean; tools?: [string, string]; count?: number } {
  if (history.length < minCycles * 2) return { detected: false };

  const recent = history.slice(-minCycles * 2);
  const keyA = getToolCallArgsKey(recent[0]);
  const keyB = getToolCallArgsKey(recent[1]);

  if (keyA === keyB) return { detected: false };

  for (let i = 0; i < recent.length; i++) {
    const expected = i % 2 === 0 ? keyA : keyB;
    const actual = history[history.length - recent.length + i];
    const actualKey = getToolCallArgsKey(actual);
    if (actualKey !== expected) return { detected: false };
  }

  return { detected: true, tools: [recent[0].name, recent[1].name], count: recent.length };
}

/**
 * Detect no-progress polling: repeated same tool with unchanged results
 */
export function detectNoProgress(
  history: ToolCallRecord[],
  minRepeats: number = 3,
): { detected: boolean; tool?: string; count?: number } {
  if (history.length < minRepeats) return { detected: false };

  const byTool = new Map<
    string,
    Array<{ args: string; result?: string; argsHash?: string; resultHash?: string }>
  >();
  for (const h of history) {
    if (!byTool.has(h.name)) byTool.set(h.name, []);
    byTool.get(h.name)!.push({
      args: h.arguments,
      result: h.result,
      argsHash: getToolCallArgsKey(h),
      resultHash: getToolCallResultKey(h),
    });
  }

  for (const [tool, calls] of byTool) {
    if (calls.length < minRepeats) continue;

    const recent = calls.slice(-minRepeats);
    const allSameArgs = recent.every(
      (c) => (c.argsHash ?? c.args) === (recent[0].argsHash ?? recent[0].args),
    );
    const allHaveResult = recent.every((c) => c.result !== undefined || c.resultHash !== undefined);
    const allSameResult =
      allHaveResult &&
      recent.every(
        (c) => (c.resultHash ?? c.result) === (recent[0].resultHash ?? recent[0].result),
      );

    if (allSameArgs && allSameResult) {
      return { detected: true, tool, count: recent.length };
    }
  }

  return { detected: false };
}

export function detectRepeatedErrors(
  history: ToolCallRecord[],
  minRepeats: number = ERROR_WARNING_THRESHOLD,
): { detected: boolean; tool?: string; count?: number } {
  if (history.length < minRepeats) {
    return { detected: false };
  }

  const byTool = new Map<
    string,
    Array<{ args: string; result?: string; argsHash?: string; resultHash?: string }>
  >();
  for (const h of history) {
    if (!byTool.has(h.name)) byTool.set(h.name, []);
    byTool.get(h.name)!.push({
      args: h.arguments,
      result: h.result,
      argsHash: getToolCallArgsKey(h),
      resultHash: getToolCallResultKey(h),
    });
  }

  for (const [tool, calls] of byTool) {
    if (calls.length < minRepeats) continue;

    const recent = calls.slice(-minRepeats);
    const allSameArgs = recent.every(
      (c) => (c.argsHash ?? c.args) === (recent[0].argsHash ?? recent[0].args),
    );
    const allErrors = recent.every((c) => isErrorLikeResult(c.result));
    const allSameResult =
      allErrors &&
      recent.every(
        (c) => (c.resultHash ?? c.result) === (recent[0].resultHash ?? recent[0].result),
      );

    if (allSameArgs && allErrors && allSameResult) {
      return { detected: true, tool, count: recent.length };
    }
  }

  return { detected: false };
}

/**
 * Get no-progress streak for a specific tool+args combo (Kavi-style).
 */
function getNoProgressStreak(history: ToolCallRecord[], toolName: string, argsKey: string): number {
  let streak = 0;
  let lastResultKey: string | undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    const hKey = getToolCallArgsKey(h);
    if (h.name !== toolName || hKey !== argsKey) continue;

    const rKey = getToolCallResultKey(h) ?? h.result;
    if (rKey === undefined) continue;

    if (!lastResultKey) {
      lastResultKey = rKey;
      streak = 1;
      continue;
    }
    if (rKey !== lastResultKey) break;
    streak++;
  }

  return streak;
}

function getRepeatedErrorStreak(
  history: ToolCallRecord[],
  toolName: string,
  argsKey: string,
): number {
  let streak = 0;
  let lastResultKey: string | undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    const hKey = getToolCallArgsKey(h);
    if (h.name !== toolName || hKey !== argsKey || !isErrorLikeResult(h.result)) continue;

    const rKey = getToolCallResultKey(h) ?? h.result;
    if (rKey === undefined) continue;

    if (!lastResultKey) {
      lastResultKey = rKey;
      streak = 1;
      continue;
    }

    if (rKey !== lastResultKey) break;
    streak++;
  }

  return streak;
}

function detectToolSpecificNoProgress(
  history: ToolCallRecord[],
  level: LoopSeverity,
  options?: { excludedToolNames?: ReadonlySet<string> },
): { detected: boolean; tool?: string; count?: number; guidance?: string } {
  for (const [toolName, thresholds] of Object.entries(TOOL_SPECIFIC_NO_PROGRESS_THRESHOLDS)) {
    if (options?.excludedToolNames?.has(toolName)) {
      continue;
    }

    const threshold = level === 'critical' ? thresholds.critical : thresholds.warning;
    const toolHistory = history.filter((entry) => normalizeToolNameKey(entry.name) === toolName);
    const detected = detectNoProgress(toolHistory, threshold);
    if (detected.detected) {
      return {
        detected: true,
        tool: toolName,
        count: detected.count,
        guidance: thresholds.guidance,
      };
    }
  }

  return { detected: false };
}

// ── Main detector (Kavi-style with warning/critical levels) ──────────

/**
 * Run all loop detectors with Kavi severity levels.
 * Returns warning-level results that should be injected as context,
 * and critical-level results that should block execution.
 */
export function detectLoops(
  history: ToolCallRecord[],
  context?: LoopDetectionContext,
): LoopDetectionResult {
  if (history.length === 0) return { loopDetected: false };

  const expectedAsyncMonitorTools = getExpectedAsyncMonitorToolNames(context);
  const loopCheckHistory = filterHistoryForExpectedAsyncMonitorTools(
    history,
    expectedAsyncMonitorTools,
  );

  const toolSpecificCritical = detectToolSpecificNoProgress(loopCheckHistory, 'critical', {
    excludedToolNames: expectedAsyncMonitorTools,
  });
  if (toolSpecificCritical.detected) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'known_poll_no_progress',
      count: toolSpecificCritical.count,
      details: `CRITICAL: ${toolSpecificCritical.tool} returned the same result ${toolSpecificCritical.count} times. ${toolSpecificCritical.guidance}`,
    };
  }

  const repeatedErrorCritical = detectRepeatedErrors(history, ERROR_CRITICAL_THRESHOLD);
  if (repeatedErrorCritical.detected) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'repeated_error',
      count: repeatedErrorCritical.count,
      details: `CRITICAL: ${repeatedErrorCritical.tool} failed with the same error ${repeatedErrorCritical.count} times. Stop retrying that call and change approach.`,
    };
  }

  // 1. Generic repeat (critical): catches any tool repeated too many times
  const repeatCritical = detectGenericRepeat(loopCheckHistory, CRITICAL_THRESHOLD);
  if (repeatCritical.detected) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'generic_repeat',
      count: repeatCritical.count,
      details: `CRITICAL: ${repeatCritical.tool} called ${repeatCritical.count} times with identical arguments. Execution blocked.`,
    };
  }

  // 2. No-progress (critical): same tool, same args, same result >= CRITICAL_THRESHOLD
  const noProgressCritical = detectNoProgress(loopCheckHistory, CRITICAL_THRESHOLD);
  if (noProgressCritical.detected) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'known_poll_no_progress',
      count: noProgressCritical.count,
      details: `CRITICAL: ${noProgressCritical.tool} called ${noProgressCritical.count} times with identical arguments and no progress. Execution blocked.`,
    };
  }

  // 3. Ping-pong (critical): alternating pattern >= CRITICAL_THRESHOLD
  const pingPongCritical = detectPingPong(loopCheckHistory, Math.floor(CRITICAL_THRESHOLD / 2));
  if (pingPongCritical.detected) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'ping_pong',
      count: pingPongCritical.count,
      details: `CRITICAL: Alternating tool call pattern between "${pingPongCritical.tools?.[0]}" and "${pingPongCritical.tools?.[1]}" (${pingPongCritical.count} calls). Execution blocked.`,
    };
  }

  const toolSpecificWarning = detectToolSpecificNoProgress(loopCheckHistory, 'warning', {
    excludedToolNames: expectedAsyncMonitorTools,
  });
  if (toolSpecificWarning.detected) {
    return {
      loopDetected: true,
      level: 'warning',
      type: 'known_poll_no_progress',
      count: toolSpecificWarning.count,
      details: `WARNING: ${toolSpecificWarning.tool} returned the same result ${toolSpecificWarning.count} times. ${toolSpecificWarning.guidance}`,
    };
  }

  const repeatedErrorWarning = detectRepeatedErrors(history, ERROR_WARNING_THRESHOLD);
  if (repeatedErrorWarning.detected) {
    return {
      loopDetected: true,
      level: 'warning',
      type: 'repeated_error',
      count: repeatedErrorWarning.count,
      details: `WARNING: ${repeatedErrorWarning.tool} failed with the same error ${repeatedErrorWarning.count} times. Analyze the failure and use a different tool or strategy.`,
    };
  }

  // 4. Generic repeat (warning)
  const repeatWarning = detectGenericRepeat(loopCheckHistory, WARNING_THRESHOLD);
  if (repeatWarning.detected) {
    return {
      loopDetected: true,
      level: 'warning',
      type: 'generic_repeat',
      count: repeatWarning.count,
      details: `WARNING: ${repeatWarning.tool} called ${repeatWarning.count} times with identical arguments. Consider changing your approach or providing a final response.`,
    };
  }

  // 5. No-progress (warning)
  const noProgressWarning = detectNoProgress(loopCheckHistory, WARNING_THRESHOLD);
  if (noProgressWarning.detected) {
    return {
      loopDetected: true,
      level: 'warning',
      type: 'known_poll_no_progress',
      count: noProgressWarning.count,
      details: `WARNING: ${noProgressWarning.tool} called ${noProgressWarning.count} times with no progress. Stop retrying or change approach.`,
    };
  }

  // 6. Ping-pong (warning)
  const pingPongWarning = detectPingPong(loopCheckHistory, Math.floor(WARNING_THRESHOLD / 2));
  if (pingPongWarning.detected) {
    return {
      loopDetected: true,
      level: 'warning',
      type: 'ping_pong',
      count: pingPongWarning.count,
      details: `WARNING: Alternating between "${pingPongWarning.tools?.[0]}" and "${pingPongWarning.tools?.[1]}" (${pingPongWarning.count} calls). Stop retrying or change approach.`,
    };
  }

  return { loopDetected: false };
}

/**
 * Pre-call check: should this tool call be blocked?
 * Checks BEFORE execution (unlike detectLoops which checks the full history after).
 */
export function shouldBlockToolCall(
  history: ToolCallRecord[],
  toolName: string,
  argsString: string,
  context?: LoopDetectionContext,
): LoopDetectionResult {
  const argsKey = buildCanonicalToolArgsKey(toolName, argsString) ?? `${toolName}::${argsString}`;
  const noProgressStreak = getNoProgressStreak(history, toolName, argsKey);
  const repeatedErrorStreak = getRepeatedErrorStreak(history, toolName, argsKey);
  const normalizedToolName = normalizeToolNameKey(toolName);
  const toolSpecificThresholds = TOOL_SPECIFIC_NO_PROGRESS_THRESHOLDS[normalizedToolName];
  const expectedAsyncMonitorTools = getExpectedAsyncMonitorToolNames(context);

  if (repeatedErrorStreak >= ERROR_CRITICAL_THRESHOLD) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'repeated_error',
      count: repeatedErrorStreak,
      details: `Blocked: ${toolName} failed with the same error ${repeatedErrorStreak} times. Change approach instead of retrying it again.`,
    };
  }

  if (expectedAsyncMonitorTools.has(normalizedToolName)) {
    return { loopDetected: false };
  }

  if (toolSpecificThresholds && noProgressStreak >= toolSpecificThresholds.critical) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'known_poll_no_progress',
      count: noProgressStreak,
      details: `Blocked: ${toolName} returned the same result ${noProgressStreak} times. ${toolSpecificThresholds.guidance}`,
    };
  }

  if (noProgressStreak >= GLOBAL_CIRCUIT_BREAKER_THRESHOLD) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'global_circuit_breaker',
      count: noProgressStreak,
      details: `Blocked: global circuit breaker — ${toolName} repeated ${noProgressStreak} times with no progress.`,
    };
  }

  if (noProgressStreak >= CRITICAL_THRESHOLD) {
    return {
      loopDetected: true,
      level: 'critical',
      type: 'known_poll_no_progress',
      count: noProgressStreak,
      details: `Blocked: ${toolName} repeated ${noProgressStreak} times with no progress.`,
    };
  }

  return { loopDetected: false };
}

/**
 * Maintain sliding window: push entry and trim to TOOL_CALL_HISTORY_SIZE.
 */
export function recordToolCall(history: ToolCallRecord[], entry: ToolCallRecord): void {
  history.push({
    ...entry,
    argsHash:
      buildCanonicalToolArgsKey(entry.name, entry.arguments, entry.result) ?? entry.argsHash,
    resultHash: buildCanonicalToolResultHash(entry.name, entry.result) ?? entry.resultHash,
  });
  if (history.length > TOOL_CALL_HISTORY_SIZE) {
    history.splice(0, history.length - TOOL_CALL_HISTORY_SIZE);
  }
}
