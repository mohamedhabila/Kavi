// ---------------------------------------------------------------------------
// Kavi — Scoped working memory blocks
// ---------------------------------------------------------------------------
// `profile`, `persona`, and `preferences` remain global memory blocks. Rolling
// state such as `active_focus` and `open_threads` is conversation/task scoped
// so one thread cannot bleed into another thread's prompt.
// ---------------------------------------------------------------------------

import { getMemoryDb } from './sqlite-store';
import { ensureFactSchema } from './schema';

export type WorkingBlockLabel = 'active_focus' | 'open_threads';

export interface WorkingBlockScope {
  conversationId?: string | null;
  threadId?: string | null;
  taskId?: string | null;
}

export interface WorkingMemoryBlock {
  label: WorkingBlockLabel;
  scopeKey: string;
  conversationId: string | null;
  threadId: string | null;
  taskId: string | null;
  content: string;
  charLimit: number;
  description: string;
  updatedAt: number;
}

interface WorkingBlockRow {
  label: string;
  scope_key: string;
  conversation_id: string | null;
  thread_id: string | null;
  task_id: string | null;
  content: string;
  char_limit: number;
  description: string;
  updated_at: number;
}

const WORKING_BLOCK_DEFS: Record<WorkingBlockLabel, { charLimit: number; description: string }> = {
  active_focus: {
    charLimit: 800,
    description: 'Scoped rolling summary of what this conversation/task is currently about.',
  },
  open_threads: {
    charLimit: 800,
    description: 'Scoped unresolved follow-ups for this conversation/task.',
  },
};

function cleanId(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export function buildWorkingBlockScopeKey(scope: WorkingBlockScope = {}): string {
  const conversationId = cleanId(scope.conversationId);
  const threadId = cleanId(scope.threadId) ?? conversationId;
  const taskId = cleanId(scope.taskId);
  if (!conversationId && !threadId && !taskId) return 'global';
  return [
    `conversation:${conversationId ?? ''}`,
    `thread:${threadId ?? ''}`,
    `task:${taskId ?? ''}`,
  ].join('|');
}

function rowToWorkingBlock(row: WorkingBlockRow): WorkingMemoryBlock {
  return {
    label: row.label === 'open_threads' ? 'open_threads' : 'active_focus',
    scopeKey: row.scope_key,
    conversationId: row.conversation_id,
    threadId: row.thread_id,
    taskId: row.task_id,
    content: row.content,
    charLimit: row.char_limit,
    description: row.description,
    updatedAt: row.updated_at,
  };
}

function definitionFor(label: WorkingBlockLabel): { charLimit: number; description: string } {
  return WORKING_BLOCK_DEFS[label];
}

export function getWorkingBlock(
  label: WorkingBlockLabel,
  scope: WorkingBlockScope = {},
): WorkingMemoryBlock | null {
  ensureFactSchema();
  const scopeKey = buildWorkingBlockScopeKey(scope);
  const row = getMemoryDb().getFirstSync<WorkingBlockRow>(
    `SELECT * FROM memory_working_blocks WHERE label = ? AND scope_key = ? LIMIT 1`,
    label,
    scopeKey,
  );
  return row ? rowToWorkingBlock(row) : null;
}

export function listRecentWorkingBlocks(
  label: WorkingBlockLabel,
  limit = 10,
): WorkingMemoryBlock[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<WorkingBlockRow>(
    `SELECT * FROM memory_working_blocks
       WHERE label = ? AND content <> ''
       ORDER BY updated_at DESC
       LIMIT ?`,
    label,
    Math.max(1, Math.min(limit, 50)),
  );
  return rows.map(rowToWorkingBlock);
}

export function editWorkingBlock(
  label: WorkingBlockLabel,
  content: string,
  scope: WorkingBlockScope = {},
  options: { now?: number } = {},
): WorkingMemoryBlock {
  ensureFactSchema();
  const db = getMemoryDb();
  const now = options.now ?? Date.now();
  const def = definitionFor(label);
  const trimmed = content.trim();
  if (trimmed.length > def.charLimit) {
    throw new Error(`working block "${label}" overflow: ${trimmed.length} > ${def.charLimit}`);
  }
  const conversationId = cleanId(scope.conversationId);
  const threadId = cleanId(scope.threadId) ?? conversationId;
  const taskId = cleanId(scope.taskId);
  const scopeKey = buildWorkingBlockScopeKey({ conversationId, threadId, taskId });
  const existing = db.getFirstSync<WorkingBlockRow>(
    `SELECT * FROM memory_working_blocks WHERE label = ? AND scope_key = ? LIMIT 1`,
    label,
    scopeKey,
  );
  if (existing) {
    db.runSync(
      `UPDATE memory_working_blocks
         SET content = ?, char_limit = ?, description = ?, conversation_id = ?, thread_id = ?, task_id = ?, updated_at = ?
         WHERE label = ? AND scope_key = ?`,
      trimmed,
      def.charLimit,
      def.description,
      conversationId,
      threadId,
      taskId,
      now,
      label,
      scopeKey,
    );
  } else {
    db.runSync(
      `INSERT INTO memory_working_blocks
         (label, scope_key, conversation_id, thread_id, task_id, content, char_limit, description, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      label,
      scopeKey,
      conversationId,
      threadId,
      taskId,
      trimmed,
      def.charLimit,
      def.description,
      now,
    );
  }
  return {
    label,
    scopeKey,
    conversationId,
    threadId,
    taskId,
    content: trimmed,
    charLimit: def.charLimit,
    description: def.description,
    updatedAt: now,
  };
}

export function clearWorkingBlock(
  label: WorkingBlockLabel,
  scope: WorkingBlockScope = {},
  now = Date.now(),
): boolean {
  ensureFactSchema();
  const scopeKey = buildWorkingBlockScopeKey(scope);
  const result = getMemoryDb().runSync(
    `UPDATE memory_working_blocks SET content = '', updated_at = ? WHERE label = ? AND scope_key = ?`,
    now,
    label,
    scopeKey,
  );
  return (result.changes ?? 0) > 0;
}
