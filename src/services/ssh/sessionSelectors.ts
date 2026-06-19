import type { useSshSessionStore } from './sessionStore';

export function selectSshSessionRuntimeSlice(state: ReturnType<typeof useSshSessionStore.getState>) {
  return {
    sessions: state.sessions,
    openShellSession: state.openShellSession,
    writeShellInput: state.writeShellInput,
    closeShellSession: state.closeShellSession,
  };
}
