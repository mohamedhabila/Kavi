// ---------------------------------------------------------------------------
// Kavi — Scoped working memory blocks
// ---------------------------------------------------------------------------
// Rolling state such as `active_focus` and `open_threads` is code-owned and
// conversation/task scoped so one thread cannot bleed into another prompt.
// ---------------------------------------------------------------------------

import { getMany, getOne, runMemoryStatement } from './access/crud';
import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { notifyStructuredMemoryChanged } from './changeNotifications';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { runAfterMemoryTransactionCommit } from './access/transaction';
import { canWriteLongTermMemory } from './policy';

export type WorkingBlockLabel =
  | 'active_focus'
  | 'open_threads'
  | 'compaction_summary'
  | 'task_stack';

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
  promptEligibility: WorkingBlockPromptEligibility;
  updatedAt: number;
}

export type WorkingBlockPromptEligibility = 'trusted_structural' | 'untrusted';

interface WorkingBlockRow {
  label: string;
  scope_key: string;
  conversation_id: string | null;
  thread_id: string | null;
  task_id: string | null;
  content: string;
  char_limit: number;
  description: string;
  prompt_eligibility: string;
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
  compaction_summary: {
    charLimit: 2000,
    description: 'Durable summary of the last context compaction for this conversation.',
  },
  task_stack: {
    charLimit: 4000,
    description: 'Stack of active, paused, and completed tasks for this conversation.',
  },
};

function exactOptionalId(
  value: string | null | undefined,
  field: 'conversation' | 'thread' | 'task',
): string | null {
  if (value === null || value === undefined) return null;
  if (!isExactMemoryScopeId(value)) throw new Error(`working_block_${field}_id_invalid`);
  return value;
}

export function buildWorkingBlockScopeKey(scope: WorkingBlockScope = {}): string {
  const conversationId = exactOptionalId(scope.conversationId, 'conversation');
  const threadId = exactOptionalId(scope.threadId, 'thread') ?? conversationId;
  const taskId = exactOptionalId(scope.taskId, 'task');
  if (!conversationId && !threadId && !taskId) return 'global';
  return [
    `conversation:${conversationId ?? ''}`,
    `thread:${threadId ?? ''}`,
    `task:${taskId ?? ''}`,
  ].join('|');
}

function rowToWorkingBlock(row: WorkingBlockRow): WorkingMemoryBlock {
  return {
    label: row.label as WorkingBlockLabel,
    scopeKey: row.scope_key,
    conversationId: row.conversation_id,
    threadId: row.thread_id,
    taskId: row.task_id,
    content: row.content,
    charLimit: row.char_limit,
    description: row.description,
    promptEligibility:
      row.prompt_eligibility === 'trusted_structural' ? 'trusted_structural' : 'untrusted',
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
  const scopeKey = buildWorkingBlockScopeKey(scope);
  const row = getOne<WorkingBlockRow>(
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
  const rows = getMany<WorkingBlockRow>(
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
  options: { now?: number; promptEligibility?: WorkingBlockPromptEligibility } = {},
): WorkingMemoryBlock {
  if (!canWriteLongTermMemory()) throw new Error('memory_disabled');
  const db = getSchemaReadyMemoryDb();
  const now = options.now ?? Date.now();
  const def = definitionFor(label);
  const trimmed = content.trim();
  if (trimmed.length > def.charLimit) {
    throw new Error(`working block "${label}" overflow: ${trimmed.length} > ${def.charLimit}`);
  }
  const conversationId = exactOptionalId(scope.conversationId, 'conversation');
  const threadId = exactOptionalId(scope.threadId, 'thread') ?? conversationId;
  const taskId = exactOptionalId(scope.taskId, 'task');
  const promptEligibility = options.promptEligibility ?? 'untrusted';
  if (promptEligibility !== 'trusted_structural' && promptEligibility !== 'untrusted') {
    throw new Error('working_block_prompt_eligibility_invalid');
  }
  const scopeKey = buildWorkingBlockScopeKey({ conversationId, threadId, taskId });
  const existing = db.getFirstSync<WorkingBlockRow>(
    `SELECT * FROM memory_working_blocks WHERE label = ? AND scope_key = ? LIMIT 1`,
    label,
    scopeKey,
  );
  if (existing) {
    db.runSync(
      `UPDATE memory_working_blocks
         SET content = ?, char_limit = ?, description = ?, conversation_id = ?, thread_id = ?, task_id = ?, prompt_eligibility = ?, updated_at = ?
         WHERE label = ? AND scope_key = ?`,
      trimmed,
      def.charLimit,
      def.description,
      conversationId,
      threadId,
      taskId,
      promptEligibility,
      now,
      label,
      scopeKey,
    );
  } else {
    db.runSync(
      `INSERT INTO memory_working_blocks
         (label, scope_key, conversation_id, thread_id, task_id, content, char_limit, description, prompt_eligibility, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      label,
      scopeKey,
      conversationId,
      threadId,
      taskId,
      trimmed,
      def.charLimit,
      def.description,
      promptEligibility,
      now,
    );
  }
  const block = {
    label,
    scopeKey,
    conversationId,
    threadId,
    taskId,
    content: trimmed,
    charLimit: def.charLimit,
    description: def.description,
    promptEligibility,
    updatedAt: now,
  };
  runAfterMemoryTransactionCommit(() => notifyStructuredMemoryChanged(conversationId));
  return block;
}

export function editPromptEligibleWorkingBlock(
  label: Extract<WorkingBlockLabel, 'active_focus' | 'open_threads'>,
  content: string,
  scope: WorkingBlockScope,
  options: { now?: number } = {},
): WorkingMemoryBlock {
  return editWorkingBlock(label, content, scope, {
    ...options,
    promptEligibility: 'trusted_structural',
  });
}

export function clearWorkingBlock(
  label: WorkingBlockLabel,
  scope: WorkingBlockScope = {},
  now = Date.now(),
): boolean {
  const scopeKey = buildWorkingBlockScopeKey(scope);
  const result = runMemoryStatement(
    `UPDATE memory_working_blocks SET content = '', updated_at = ? WHERE label = ? AND scope_key = ?`,
    now,
    label,
    scopeKey,
  );
  const changed = (result.changes ?? 0) > 0;
  if (changed) {
    runAfterMemoryTransactionCommit(() =>
      notifyStructuredMemoryChanged(scope.conversationId ?? scope.threadId ?? null),
    );
  }
  return changed;
}
