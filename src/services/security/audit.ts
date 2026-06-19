// ---------------------------------------------------------------------------
// Kavi — Audit Log
// ---------------------------------------------------------------------------
// Logs tool executions and API calls for security and debugging.

import { Paths, File, Directory } from 'expo-file-system';

import {
  describeToolInvocation,
  type ToolTelemetryCategory,
} from './toolPrivacy';

export interface AuditEntry {
  timestamp: number;
  type: 'tool_call' | 'api_call' | 'mcp_call' | 'permission_check';
  toolName?: string;
  arguments?: string;
  summary?: string;
  result?: 'success' | 'error' | 'denied';
  duration?: number;
  conversationId?: string;
  providerId?: string;
  model?: string;
  error?: string;
  category?: ToolTelemetryCategory;
  piiRedacted?: boolean;
}

const MAX_ENTRIES_IN_MEMORY = 500;
const MAX_ENTRIES_ON_DISK = 5000;

let auditBuffer: AuditEntry[] = [];
let auditVersion = 0;
const auditSubscribers = new Set<() => void>();

function notifyAuditSubscribers() {
  auditVersion += 1;
  for (const subscriber of auditSubscribers) {
    subscriber();
  }
}

function getAuditDir(): Directory {
  return new Directory(Paths.document, 'audit');
}

function getAuditFile(): File {
  const dir = getAuditDir();
  if (!dir.exists) dir.create();
  return new File(dir, 'audit.jsonl');
}

export function logAuditEntry(entry: AuditEntry): void {
  auditBuffer.push(entry);
  if (auditBuffer.length > MAX_ENTRIES_IN_MEMORY) {
    auditBuffer = auditBuffer.slice(-MAX_ENTRIES_IN_MEMORY);
  }
  notifyAuditSubscribers();

  // Async write to disk (fire-and-forget)
  void (async () => {
    try {
      const file = getAuditFile();
      const line = JSON.stringify(entry) + '\n';
      if (file.exists) {
        const existing = await file.text();
        const lines = existing.split('\n').filter(Boolean);
        if (lines.length > MAX_ENTRIES_ON_DISK) {
          // Trim oldest entries
          const trimmed = lines.slice(-MAX_ENTRIES_ON_DISK + 1);
          trimmed.push(JSON.stringify(entry));
          file.write(trimmed.join('\n') + '\n');
        } else {
          file.write(existing + line);
        }
      } else {
        file.write(line);
      }
    } catch {
      // Audit logging should never break the app
    }
  })();
}

export function logToolCall(
  toolName: string,
  args: string,
  result: 'success' | 'error' | 'denied',
  duration: number,
  conversationId: string,
  error?: string,
): void {
  const presentation = describeToolInvocation(toolName, args);
  logAuditEntry({
    timestamp: Date.now(),
    type: 'tool_call',
    toolName,
    arguments: presentation.redactedArguments,
    summary: presentation.description,
    result,
    duration,
    conversationId,
    error,
    category: presentation.category,
    piiRedacted: presentation.piiRedacted,
  });
}

export function logApiCall(
  providerId: string,
  model: string,
  result: 'success' | 'error',
  duration: number,
  error?: string,
): void {
  logAuditEntry({
    timestamp: Date.now(),
    type: 'api_call',
    result,
    duration,
    providerId,
    model,
    error,
  });
}

export function subscribeAuditLog(listener: () => void): () => void {
  auditSubscribers.add(listener);
  return () => {
    auditSubscribers.delete(listener);
  };
}

export function getAuditLogVersion(): number {
  return auditVersion;
}

export function getRecentAuditEntries(
  count = 50,
  options?: { category?: ToolTelemetryCategory; type?: AuditEntry['type'] },
): AuditEntry[] {
  return auditBuffer
    .filter((entry) => {
      if (options?.type && entry.type !== options.type) {
        return false;
      }
      if (options?.category && entry.category !== options.category) {
        return false;
      }
      return true;
    })
    .slice(-count);
}

export function getAuditStats(): {
  totalCalls: number;
  errorCount: number;
  toolCounts: Record<string, number>;
};
export function getAuditStats(options: {
  category?: ToolTelemetryCategory;
  type?: AuditEntry['type'];
}): {
  totalCalls: number;
  errorCount: number;
  toolCounts: Record<string, number>;
};
export function getAuditStats(options?: {
  category?: ToolTelemetryCategory;
  type?: AuditEntry['type'];
}): {
  totalCalls: number;
  errorCount: number;
  toolCounts: Record<string, number>;
} {
  const toolCounts: Record<string, number> = {};
  let errorCount = 0;

  for (const entry of auditBuffer) {
    if (options?.type && entry.type !== options.type) {
      continue;
    }
    if (options?.category && entry.category !== options.category) {
      continue;
    }
    if (entry.toolName) {
      toolCounts[entry.toolName] = (toolCounts[entry.toolName] || 0) + 1;
    }
    if (entry.result === 'error') errorCount++;
  }

  const totalCalls =
    Object.values(toolCounts).reduce((sum, count) => sum + count, 0) +
    auditBuffer.filter((entry) => {
      if (entry.toolName) {
        return false;
      }
      if (options?.type && entry.type !== options.type) {
        return false;
      }
      if (options?.category && entry.category !== options.category) {
        return false;
      }
      return true;
    }).length;

  return { totalCalls, errorCount, toolCounts };
}

export function clearAuditLog(): void {
  auditBuffer = [];
  notifyAuditSubscribers();
  try {
    const file = getAuditFile();
    if (file.exists) file.write('');
  } catch {
    // Silent
  }
}
