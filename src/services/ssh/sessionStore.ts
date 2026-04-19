import { create } from 'zustand';
import type { SshTargetConfig } from '../../types';
import { getSshTargetLabel, openSshShell, type ConnectedSshShell } from './connector';
import { generateId } from '../../utils/id';

export interface SshShellSession {
  id: string;
  targetId: string;
  targetName: string;
  targetLabel: string;
  status: 'connecting' | 'connected' | 'error' | 'closed';
  transcript: string;
  createdAt: number;
  lastActivityAt: number;
  error?: string;
}

interface SessionHandle {
  shell: ConnectedSshShell;
  target: SshTargetConfig;
}

interface SshSessionState {
  sessions: Record<string, SshShellSession>;
  openShellSession: (target: SshTargetConfig) => Promise<string>;
  writeShellInput: (sessionId: string, input: string) => Promise<void>;
  sendShellCommand: (sessionId: string, command: string) => Promise<void>;
  closeShellSession: (sessionId: string) => void;
  clearClosedSession: (sessionId: string) => void;
}

const MAX_TRANSCRIPT_CHARS = 60000;
const sessionHandles = new Map<string, SessionHandle>();

function trimTranscript(value: string): string {
  if (value.length <= MAX_TRANSCRIPT_CHARS) {
    return value;
  }
  return value.slice(value.length - MAX_TRANSCRIPT_CHARS);
}

function appendTranscript(sessionId: string, chunk: string): void {
  if (!chunk) {
    return;
  }
  useSshSessionStore.setState((state) => {
    const current = state.sessions[sessionId];
    if (!current) {
      return state;
    }
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...current,
          transcript: trimTranscript(`${current.transcript}${chunk}`),
          lastActivityAt: Date.now(),
        },
      },
    };
  });
}

function closeHandle(sessionId: string): void {
  const handle = sessionHandles.get(sessionId);
  if (!handle) {
    return;
  }
  sessionHandles.delete(sessionId);
  try {
    handle.shell.close();
  } catch {
    // Ignore shell cleanup errors.
  }
}

export const useSshSessionStore = create<SshSessionState>((set, get) => ({
  sessions: {},

  openShellSession: async (target) => {
    const sessionId = `ssh-session-${generateId()}`;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          id: sessionId,
          targetId: target.id,
          targetName: target.name,
          targetLabel: getSshTargetLabel(target),
          status: 'connecting',
          transcript: '',
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        },
      },
    }));

    try {
      const shell = await openSshShell(target, (chunk) => {
        appendTranscript(sessionId, chunk);
      });
      sessionHandles.set(sessionId, { shell, target });
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            status: 'connected',
            transcript: trimTranscript(
              `${state.sessions[sessionId]?.transcript || ''}$ ${target.username}@${target.host}\n`,
            ),
            lastActivityAt: Date.now(),
          },
        },
      }));
      return sessionId;
    } catch (error) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...state.sessions[sessionId],
            status: 'error',
            error: error instanceof Error ? error.message : 'SSH session failed',
            lastActivityAt: Date.now(),
          },
        },
      }));
      throw error;
    }
  },

  writeShellInput: async (sessionId, input) => {
    if (!input) {
      return;
    }
    const handle = sessionHandles.get(sessionId);
    const session = get().sessions[sessionId];
    if (!handle || !session || session.status !== 'connected') {
      throw new Error('ssh-session-not-connected');
    }
    await handle.shell.write(input);
  },

  sendShellCommand: async (sessionId, command) => {
    const normalized = command.endsWith('\n') ? command : `${command}\n`;
    appendTranscript(sessionId, `$ ${command}\n`);
    await get().writeShellInput(sessionId, normalized);
  },

  closeShellSession: (sessionId) => {
    closeHandle(sessionId);
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) {
        return state;
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            status: 'closed',
            lastActivityAt: Date.now(),
          },
        },
      };
    });
  },

  clearClosedSession: (sessionId) => {
    closeHandle(sessionId);
    set((state) => {
      const next = { ...state.sessions };
      delete next[sessionId];
      return { sessions: next };
    });
  },
}));
