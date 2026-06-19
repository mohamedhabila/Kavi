import { create } from 'zustand';
import type { RemoteArtifact, RemoteJobRecord, RemoteSessionRecord } from '../../types/remote';
import { generateId } from '../../utils/id';

interface RemoteStoreState {
  jobs: Record<string, RemoteJobRecord>;
  sessions: Record<string, RemoteSessionRecord>;
  createJob: (
    job: Omit<RemoteJobRecord, 'id' | 'createdAt' | 'updatedAt' | 'artifacts'> & {
      artifacts?: RemoteArtifact[];
    },
  ) => string;
  updateJob: (jobId: string, updates: Partial<Omit<RemoteJobRecord, 'id' | 'createdAt'>>) => void;
  addArtifact: (jobId: string, artifact: Omit<RemoteArtifact, 'id' | 'createdAt'>) => string | null;
  createSession: (
    session: Omit<RemoteSessionRecord, 'id' | 'startedAt' | 'lastActivityAt'>,
  ) => string;
  updateSession: (
    sessionId: string,
    updates: Partial<Omit<RemoteSessionRecord, 'id' | 'startedAt'>>,
  ) => void;
  closeSession: (sessionId: string, status?: RemoteSessionRecord['status'], error?: string) => void;
  clearJob: (jobId: string) => void;
  clearSession: (sessionId: string) => void;
}

const MAX_REMOTE_JOBS = 60;
const MAX_REMOTE_SESSIONS = 24;
const sessionRuntime = new Map<string, Record<string, string>>();

function trimJobMap(jobs: Record<string, RemoteJobRecord>): Record<string, RemoteJobRecord> {
  const entries = Object.entries(jobs)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_REMOTE_JOBS);
  return Object.fromEntries(entries);
}

function trimSessionMap(
  sessions: Record<string, RemoteSessionRecord>,
): Record<string, RemoteSessionRecord> {
  const entries = Object.entries(sessions)
    .sort(([, left], [, right]) => right.lastActivityAt - left.lastActivityAt)
    .slice(0, MAX_REMOTE_SESSIONS);
  return Object.fromEntries(entries);
}

export const useRemoteStore = create<RemoteStoreState>((set) => ({
  jobs: {},
  sessions: {},

  createJob: (job) => {
    const jobId = `remote-job-${generateId()}`;
    const timestamp = Date.now();
    set((state) => ({
      jobs: trimJobMap({
        ...state.jobs,
        [jobId]: {
          ...job,
          id: jobId,
          artifacts: job.artifacts || [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }),
    }));
    return jobId;
  },

  updateJob: (jobId, updates) => {
    set((state) => {
      const current = state.jobs[jobId];
      if (!current) {
        return state;
      }
      return {
        jobs: trimJobMap({
          ...state.jobs,
          [jobId]: {
            ...current,
            ...updates,
            updatedAt: Date.now(),
          },
        }),
      };
    });
  },

  addArtifact: (jobId, artifact) => {
    const artifactId = `remote-artifact-${generateId()}`;
    let applied = false;
    set((state) => {
      const current = state.jobs[jobId];
      if (!current) {
        return state;
      }
      applied = true;
      return {
        jobs: {
          ...state.jobs,
          [jobId]: {
            ...current,
            artifacts: [
              {
                ...artifact,
                id: artifactId,
                createdAt: Date.now(),
              },
              ...current.artifacts,
            ].slice(0, 8),
            updatedAt: Date.now(),
          },
        },
      };
    });
    return applied ? artifactId : null;
  },

  createSession: (session) => {
    const sessionId = `remote-session-${generateId()}`;
    const timestamp = Date.now();
    set((state) => ({
      sessions: trimSessionMap({
        ...state.sessions,
        [sessionId]: {
          ...session,
          id: sessionId,
          startedAt: timestamp,
          lastActivityAt: timestamp,
        },
      }),
    }));
    return sessionId;
  },

  updateSession: (sessionId, updates) => {
    set((state) => {
      const current = state.sessions[sessionId];
      if (!current) {
        return state;
      }
      return {
        sessions: trimSessionMap({
          ...state.sessions,
          [sessionId]: {
            ...current,
            ...updates,
            lastActivityAt: Date.now(),
          },
        }),
      };
    });
  },

  closeSession: (sessionId, status = 'closed', error) => {
    set((state) => {
      const current = state.sessions[sessionId];
      if (!current) {
        return state;
      }
      return {
        sessions: trimSessionMap({
          ...state.sessions,
          [sessionId]: {
            ...current,
            status,
            error,
            lastActivityAt: Date.now(),
          },
        }),
      };
    });
    if (status === 'closed') {
      sessionRuntime.delete(sessionId);
    }
  },

  clearJob: (jobId) => {
    set((state) => {
      const next = { ...state.jobs };
      delete next[jobId];
      return { jobs: next };
    });
  },

  clearSession: (sessionId) => {
    sessionRuntime.delete(sessionId);
    set((state) => {
      const next = { ...state.sessions };
      delete next[sessionId];
      return { sessions: next };
    });
  },
}));

export function setRemoteSessionRuntime(sessionId: string, metadata: Record<string, string>): void {
  sessionRuntime.set(sessionId, metadata);
}

export function getRemoteSessionRuntime(sessionId: string): Record<string, string> | undefined {
  return sessionRuntime.get(sessionId);
}

export function clearRemoteSessionRuntime(sessionId: string): void {
  sessionRuntime.delete(sessionId);
}

export function startRemoteJob(job: Parameters<RemoteStoreState['createJob']>[0]): string {
  return useRemoteStore.getState().createJob(job);
}

export function updateRemoteJob(
  jobId: string,
  updates: Parameters<RemoteStoreState['updateJob']>[1],
): void {
  useRemoteStore.getState().updateJob(jobId, updates);
}

export function addRemoteArtifact(
  jobId: string,
  artifact: Parameters<RemoteStoreState['addArtifact']>[1],
): string | null {
  return useRemoteStore.getState().addArtifact(jobId, artifact);
}

export function openRemoteSession(
  session: Parameters<RemoteStoreState['createSession']>[0],
): string {
  return useRemoteStore.getState().createSession(session);
}

export function updateRemoteSession(
  sessionId: string,
  updates: Parameters<RemoteStoreState['updateSession']>[1],
): void {
  useRemoteStore.getState().updateSession(sessionId, updates);
}

export function closeRemoteSession(
  sessionId: string,
  status?: RemoteSessionRecord['status'],
  error?: string,
): void {
  useRemoteStore.getState().closeSession(sessionId, status, error);
}

export function resetRemoteStore(): void {
  sessionRuntime.clear();
  useRemoteStore.setState((state) => ({
    ...state,
    jobs: {},
    sessions: {},
  }));
}
