// ---------------------------------------------------------------------------
// Kavi — Task Stack
// ---------------------------------------------------------------------------
// A conversation-scoped stack of tasks stored as a JSON working block.
// No new tables; reuses memory_working_blocks with label 'task_stack'.
//
// Design:
//   - Tasks are explicit, not heuristically detected from natural language.
//   - The active task scopes memory recall (facts, episodes, working blocks).
//   - Sub-agents and execution units receive a taskId that isolates their
//     memory from sibling work in the same conversation.
//   - Human-memory analogy: a person holds a stack of current goals; when
//     context switches, the previous goal is paused, not forgotten.
//
// No NLP. No thresholds. Pure structural state.
// ---------------------------------------------------------------------------

import { generateId } from '../../utils/id';
import { editWorkingBlock, getWorkingBlock } from './workingBlocks';

export interface TaskStackEntry {
  id: string;
  title: string;
  startedAt: number;
  lastActiveAt: number;
  state: 'active' | 'paused' | 'completed';
}

function parseTaskStack(content: string): TaskStackEntry[] {
  if (!content.trim()) return [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as TaskStackEntry[];
  } catch {
    // Invalid JSON — treat as empty stack
  }
  return [];
}

function serializeTaskStack(entries: TaskStackEntry[]): string {
  return JSON.stringify(entries);
}

function readBlock(threadId: string): TaskStackEntry[] {
  try {
    const block = getWorkingBlock('task_stack', { conversationId: threadId, threadId });
    return parseTaskStack(block?.content ?? '');
  } catch {
    return [];
  }
}

function writeBlock(threadId: string, entries: TaskStackEntry[]): void {
  editWorkingBlock('task_stack', serializeTaskStack(entries), {
    conversationId: threadId,
    threadId,
  });
}

/** Read the current task stack for a conversation. */
export function readTaskStack(threadId: string): TaskStackEntry[] {
  return readBlock(threadId);
}

/** Push a new task onto the stack and mark it active (pausing the previous active task). */
export function pushTask(threadId: string, title: string): TaskStackEntry {
  const now = Date.now();
  const entries = readBlock(threadId).map((e) =>
    e.state === 'active' ? { ...e, state: 'paused' as const, lastActiveAt: now } : e,
  );
  const entry: TaskStackEntry = {
    id: generateId(),
    title: title.trim(),
    startedAt: now,
    lastActiveAt: now,
    state: 'active',
  };
  entries.push(entry);
  writeBlock(threadId, entries);
  return entry;
}

/** Pop the top task from the stack. Returns the removed entry or null if empty. */
export function popTask(threadId: string): TaskStackEntry | null {
  const entries = readBlock(threadId);
  if (entries.length === 0) return null;
  const removed = entries.pop()!;
  // Activate the next top task if it exists and is paused
  if (entries.length > 0 && entries[entries.length - 1].state === 'paused') {
    entries[entries.length - 1] = {
      ...entries[entries.length - 1],
      state: 'active',
      lastActiveAt: Date.now(),
    };
  }
  writeBlock(threadId, entries);
  return removed;
}

/** Mark a specific task as active, pausing all others. */
export function activateTask(threadId: string, taskId: string): void {
  const entries = readBlock(threadId);
  const hasTarget = entries.some((e) => e.id === taskId);
  if (!hasTarget) return;
  const now = Date.now();
  const updated = entries.map((e) => {
    if (e.id === taskId) return { ...e, state: 'active' as const, lastActiveAt: now };
    if (e.state === 'active') return { ...e, state: 'paused' as const, lastActiveAt: now };
    return e;
  });
  writeBlock(threadId, updated);
}

/** Mark a specific task as completed. */
export function completeTask(threadId: string, taskId: string): void {
  const entries = readBlock(threadId).map((e) =>
    e.id === taskId ? { ...e, state: 'completed' as const, lastActiveAt: Date.now() } : e,
  );
  writeBlock(threadId, entries);
}

/** Mark a specific task as paused without changing other entries. */
export function pauseTask(threadId: string, taskId: string, now: number = Date.now()): void {
  const trimmedId = taskId.trim();
  if (!threadId.trim() || !trimmedId) return;
  const entries = readBlock(threadId).map((entry) =>
    entry.id === trimmedId
      ? { ...entry, state: 'paused' as const, lastActiveAt: now }
      : entry,
  );
  writeBlock(threadId, entries);
}

/**
 * Insert or update a task entry using a stable id (graph goal id). Structural
 * only — callers supply explicit ids and titles.
 */
export function upsertGoalTaskEntry(
  threadId: string,
  taskId: string,
  title: string,
  state: TaskStackEntry['state'],
  now: number = Date.now(),
): TaskStackEntry {
  const trimmedThreadId = threadId.trim();
  const trimmedId = taskId.trim();
  const trimmedTitle = title.trim();
  if (!trimmedThreadId || !trimmedId || !trimmedTitle) {
    throw new Error('upsertGoalTaskEntry: threadId, taskId, and title are required');
  }

  let entries = readBlock(trimmedThreadId);
  const existingIndex = entries.findIndex((entry) => entry.id === trimmedId);

  if (existingIndex < 0) {
    if (state === 'active') {
      entries = entries.map((entry) =>
        entry.state === 'active'
          ? { ...entry, state: 'paused' as const, lastActiveAt: now }
          : entry,
      );
    }
    const created: TaskStackEntry = {
      id: trimmedId,
      title: trimmedTitle,
      startedAt: now,
      lastActiveAt: now,
      state,
    };
    entries.push(created);
    writeBlock(trimmedThreadId, entries);
    return created;
  }

  if (state === 'active') {
    const updated = entries.map((entry) => {
      if (entry.id === trimmedId) {
        return {
          ...entry,
          title: trimmedTitle,
          state: 'active' as const,
          lastActiveAt: now,
        };
      }
      if (entry.state === 'active') {
        return { ...entry, state: 'paused' as const, lastActiveAt: now };
      }
      return entry;
    });
    writeBlock(trimmedThreadId, updated);
    return updated.find((entry) => entry.id === trimmedId)!;
  }

  const updated = entries.map((entry) =>
    entry.id === trimmedId
      ? { ...entry, title: trimmedTitle, state, lastActiveAt: now }
      : entry,
  );
  writeBlock(trimmedThreadId, updated);
  return updated.find((entry) => entry.id === trimmedId)!;
}

/** Get the ID of the currently active task, or null if none. */
export function getActiveTaskId(threadId: string): string | null {
  const entries = readBlock(threadId);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].state === 'active') return entries[i].id;
  }
  return null;
}

/** Get the title of the currently active task, or null if none. */
export function getActiveTaskTitle(threadId: string): string | null {
  const entries = readBlock(threadId);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].state === 'active') return entries[i].title;
  }
  return null;
}
