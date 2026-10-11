// ---------------------------------------------------------------------------
// Kavi — Background memory extraction worker
// ---------------------------------------------------------------------------
// A closed turn schedules its chat thread. The worker runs one thread at a time while no
// foreground turn holds the model; a foreground turn starting aborts the run, which costs
// nothing and resumes when the model is free again. A real failure is retried after a
// growing delay until the window is skipped (see memoryExtraction.ts). One timer at most is
// pending, so the worker never piles up work. Turning memory off cancels everything.
// ---------------------------------------------------------------------------

import { useChatStore } from '../../../store/useChatStore';
import { createLogger } from '../../../utils/logger';
import { isMainInferenceActive, registerIngestionPreemptionHandler } from '../onDeviceGuards';
import { extractConversationMemory, type ExtractionMessage } from './memoryExtraction';
import { resolveMemoryExtractionModel, type MemoryExtractionCall } from './memoryExtractionModel';

const logger = createLogger('memory-extraction');

export const EXTRACTION_IDLE_POLL_MS = 5_000;
export const EXTRACTION_RETRY_BASE_MS = 30_000;
const EXTRACTION_MAX_WINDOWS_PER_RUN = 8;

export interface MemoryExtractionWorkerDependencies {
  resolveModel: () => Promise<MemoryExtractionCall | null>;
  isForegroundActive: () => boolean;
  /** The thread's messages, or null when it is gone or keeps no memory (a side thread). */
  readThread: (threadId: string) => ReadonlyArray<ExtractionMessage> | null;
  now: () => number;
}

function readChatThread(threadId: string): ReadonlyArray<ExtractionMessage> | null {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === threadId);
  return conversation && !conversation.isSideThread ? conversation.messages : null;
}

const DEFAULT_DEPENDENCIES: MemoryExtractionWorkerDependencies = {
  resolveModel: resolveMemoryExtractionModel,
  isForegroundActive: isMainInferenceActive,
  readThread: readChatThread,
  now: Date.now,
};

let dependencies = DEFAULT_DEPENDENCIES;
interface PendingExtraction {
  closedThroughMessageId: string;
  /** A failed thread waits until then; others run meanwhile. */
  notBefore: number;
}

/** Queued threads in schedule order. */
const pending = new Map<string, PendingExtraction>();
let running: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribePreemption: (() => void) | null = null;
const idleWaiters = new Set<() => void>();

function ensurePreemptionHandler(): void {
  unsubscribePreemption ??= registerIngestionPreemptionHandler(() => running?.abort());
}

function wakeAfter(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void drainMemoryExtraction();
  }, delayMs);
}

/** Queue extraction for a thread whose turn closed with `closedThroughMessageId`. */
export function scheduleMemoryExtraction(threadId: string, closedThroughMessageId: string): void {
  pending.delete(threadId);
  pending.set(threadId, { closedThroughMessageId, notBefore: 0 });
  ensurePreemptionHandler();
  if (!running) void drainMemoryExtraction();
}

/** Stops all extraction now: the running call is aborted and nothing queued runs. */
export function cancelMemoryExtraction(): void {
  pending.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  running?.abort();
  notifyIfIdle();
}

function isMemoryExtractionIdle(): boolean {
  return running === null && pending.size === 0;
}

function notifyIfIdle(): void {
  if (!isMemoryExtractionIdle()) return;
  for (const resolve of idleWaiters) resolve();
  idleWaiters.clear();
}

/** Resolves true once nothing is queued or running, or false when `timeoutMs` passes first. */
export function waitForMemoryExtractionIdle(timeoutMs: number): Promise<boolean> {
  if (isMemoryExtractionIdle()) return Promise.resolve(true);
  void drainMemoryExtraction();
  return new Promise((resolve) => {
    const onIdle = () => {
      clearTimeout(deadline);
      resolve(true);
    };
    const deadline = setTimeout(
      () => {
        idleWaiters.delete(onIdle);
        resolve(false);
      },
      Math.max(0, timeoutMs),
    );
    idleWaiters.add(onIdle);
  });
}

function nextEligible(now: number): [string, PendingExtraction] | null {
  for (const entry of pending) {
    if (entry[1].notBefore <= now) return entry;
  }
  return null;
}

function earliestRetry(): number {
  let earliest = Infinity;
  for (const { notBefore } of pending.values()) earliest = Math.min(earliest, notBefore);
  return earliest;
}

/** Extracts one thread's queued windows. `controller` aborts it when a foreground turn starts. */
async function extractThread(
  threadId: string,
  closedThroughMessageId: string,
  controller: AbortController,
): Promise<'preempted' | 'done'> {
  const call = await dependencies.resolveModel();
  if (!call) {
    pending.clear();
    return 'done';
  }
  const messages = dependencies.readThread(threadId);
  if (!messages) {
    pending.delete(threadId);
    return 'done';
  }
  for (let window = 0; window < EXTRACTION_MAX_WINDOWS_PER_RUN; window += 1) {
    const outcome = await extractConversationMemory({
      conversationId: threadId,
      messages,
      closedThroughMessageId,
      call,
      signal: controller.signal,
      now: dependencies.now,
    });
    if (outcome.kind === 'preempted') return 'preempted';
    if (outcome.kind === 'failed') {
      // Back of the queue with a delay, so other threads are not held behind it.
      pending.delete(threadId);
      pending.set(threadId, {
        closedThroughMessageId,
        notBefore: dependencies.now() + EXTRACTION_RETRY_BASE_MS * outcome.failures,
      });
      return 'done';
    }
    if (outcome.kind === 'idle') {
      if (pending.get(threadId)?.closedThroughMessageId === closedThroughMessageId) {
        pending.delete(threadId);
      }
      return 'done';
    }
  }
  return 'done';
}

/** Runs queued threads until the queue is empty, the model is busy or a run fails. */
async function drainMemoryExtraction(): Promise<void> {
  if (running || pending.size === 0) return;
  if (dependencies.isForegroundActive()) {
    wakeAfter(EXTRACTION_IDLE_POLL_MS);
    return;
  }
  const now = dependencies.now();
  const next = nextEligible(now);
  if (!next) {
    wakeAfter(Math.max(0, earliestRetry() - now));
    return;
  }
  // Claimed before the first await, so a second drain started meanwhile returns at once.
  const controller = new AbortController();
  running = controller;
  const [threadId, { closedThroughMessageId }] = next;
  let outcome: 'preempted' | 'done' = 'done';
  try {
    outcome = await extractThread(threadId, closedThroughMessageId, controller);
  } catch (error) {
    logger.error('Memory extraction failed unexpectedly.', error);
    pending.delete(threadId);
  } finally {
    running = null;
  }
  // A foreground turn holds the model: every thread waits for it, so poll.
  if (outcome === 'preempted') wakeAfter(EXTRACTION_IDLE_POLL_MS);
  else if (pending.size > 0) void drainMemoryExtraction();
  notifyIfIdle();
}

export function __resetMemoryExtractionWorkerForTests(
  overrides: Partial<MemoryExtractionWorkerDependencies> = {},
): void {
  if (timer) clearTimeout(timer);
  timer = null;
  running = null;
  pending.clear();
  idleWaiters.clear();
  unsubscribePreemption?.();
  unsubscribePreemption = null;
  dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
}
