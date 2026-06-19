import type { useRemoteStore } from './store';

export function selectRemoteRuntimeSlice(state: ReturnType<typeof useRemoteStore.getState>) {
  return {
    jobs: state.jobs,
    sessions: state.sessions,
  };
}
