// ---------------------------------------------------------------------------
// Kavi — Browser Action Trace Store (Zustand)
// ---------------------------------------------------------------------------
// Records every browser automation action for session replay, debugging,
// and audit.

import { create } from 'zustand';
import { generateId } from '../../utils/id';

// ── Types ────────────────────────────────────────────────────────────────

export type BrowserTraceStatus = 'pending' | 'success' | 'error';

export interface BrowserTraceEntry {
  id: string;
  sessionId: string;
  /** The tool or action kind that was executed (e.g. 'click', 'type', 'navigate') */
  action: string;
  /** Human-readable summary of the action */
  description: string;
  /** Raw request payload for debugging */
  request?: Record<string, unknown>;
  /** Raw response payload for debugging */
  response?: Record<string, unknown>;
  /** Screenshot base64 captured after the action (optional) */
  screenshotBase64?: string;
  /** Page URL at the time of the action */
  pageUrl?: string;
  status: BrowserTraceStatus;
  error?: string;
  /** Duration of the action in ms */
  durationMs?: number;
  timestamp: number;
}

interface BrowserTraceStoreState {
  /** Map of sessionId → ordered list of trace entries */
  traces: Record<string, BrowserTraceEntry[]>;

  /** Record a new trace entry. Returns the entry id. */
  recordTrace: (entry: Omit<BrowserTraceEntry, 'id' | 'timestamp'>) => string;

  /** Update a pending trace with result data */
  resolveTrace: (
    entryId: string,
    sessionId: string,
    updates: Partial<
      Pick<
        BrowserTraceEntry,
        'status' | 'response' | 'error' | 'durationMs' | 'screenshotBase64' | 'pageUrl'
      >
    >,
  ) => void;

  /** Get traces for a specific session */
  getSessionTraces: (sessionId: string) => BrowserTraceEntry[];

  /** Clear traces for a specific session */
  clearSessionTraces: (sessionId: string) => void;

  /** Clear all traces */
  clearAll: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Max trace entries per session before oldest are pruned */
const MAX_TRACES_PER_SESSION = 500;

// ── Store ────────────────────────────────────────────────────────────────

export const useBrowserTraceStore = create<BrowserTraceStoreState>((set, get) => ({
  traces: {},

  recordTrace: (entry) => {
    const id = `bt-${generateId()}`;
    const full: BrowserTraceEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
    };

    set((state) => {
      const sessionTraces = state.traces[entry.sessionId] || [];
      const updated = [full, ...sessionTraces].slice(0, MAX_TRACES_PER_SESSION);
      return { traces: { ...state.traces, [entry.sessionId]: updated } };
    });

    return id;
  },

  resolveTrace: (entryId, sessionId, updates) => {
    set((state) => {
      const sessionTraces = state.traces[sessionId];
      if (!sessionTraces) return state;

      const updatedTraces = sessionTraces.map((t) => (t.id === entryId ? { ...t, ...updates } : t));

      return { traces: { ...state.traces, [sessionId]: updatedTraces } };
    });
  },

  getSessionTraces: (sessionId) => {
    return get().traces[sessionId] || [];
  },

  clearSessionTraces: (sessionId) => {
    set((state) => {
      const next = { ...state.traces };
      delete next[sessionId];
      return { traces: next };
    });
  },

  clearAll: () => {
    set({ traces: {} });
  },
}));

// ── Convenience helpers ──────────────────────────────────────────────────

/**
 * Record a browser action trace entry with timing.
 * Call this before executing the action, then resolveTrace() after.
 */
export function startBrowserTrace(
  sessionId: string,
  action: string,
  description: string,
  request?: Record<string, unknown>,
): string {
  return useBrowserTraceStore.getState().recordTrace({
    sessionId,
    action,
    description,
    request,
    status: 'pending',
  });
}

/**
 * Resolve a pending trace with its result.
 */
export function completeBrowserTrace(
  entryId: string,
  sessionId: string,
  result: {
    status: BrowserTraceStatus;
    response?: Record<string, unknown>;
    error?: string;
    durationMs?: number;
    screenshotBase64?: string;
    pageUrl?: string;
  },
): void {
  useBrowserTraceStore.getState().resolveTrace(entryId, sessionId, result);
}
