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
import { canWriteLongTermMemory } from './policy';
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

function assertTaskStackWritable(): void {
  if (!canWriteLongTermMemory()) throw new Error('memory_disabled');
}

/** Read the current task stack for a conversation. */
export function readTaskStack(threadId: string): TaskStackEntry[] {
  return readBlock(threadId);
}

/** Push a new task onto the stack and mark it active (pausing the previous active task). */
export function pushTask(threadId: string, title: string): TaskStackEntry {
  assertTaskStackWritable();
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

/** Mark a specific task as completed. */
export function completeTask(threadId: string, taskId: string): void {
  assertTaskStackWritable();
  const entries = readBlock(threadId).map((e) =>
    e.id === taskId ? { ...e, state: 'completed' as const, lastActiveAt: Date.now() } : e,
  );
  writeBlock(threadId, entries);
}

/** Get the title of the currently active task, or null if none. */
export function getActiveTaskTitle(threadId: string): string | null {
  const entries = readBlock(threadId);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].state === 'active') return entries[i].title;
  }
  return null;
}
