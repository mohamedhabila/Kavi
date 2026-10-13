import { createJSONStorage } from 'zustand/middleware';
import { startOverFromOtherVersion } from '../../src/store/persistedStoreVersion';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { useApprovalStore } from '../../src/services/remote/approvalStore';
import { useSchedulerStore } from '../../src/services/scheduler/store';
import { useExecutionTraceStore } from '../../src/services/scheduler/traceStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';
import { usePersonaConfigStore } from '../../src/services/agents/store';
import { useProactiveProposalStore } from '../../src/services/agents/proactiveProposalStore';
import { useSkillsStore } from '../../src/services/skills/manager';

// Kavi keeps no compatibility with earlier storage shapes: every persisted store drops state
// written by another version and starts over, instead of carrying migration chains.
const PERSISTED_STORES = {
  chat: useChatStore,
  settings: useSettingsStore,
  approvals: useApprovalStore,
  scheduler: useSchedulerStore,
  executionTraces: useExecutionTraceStore,
  toolPermissions: useToolPermissionsStore,
  personaConfig: usePersonaConfigStore,
  proactiveProposals: useProactiveProposalStore,
  skills: useSkillsStore,
};

describe('persisted store versions', () => {
  it.each(Object.entries(PERSISTED_STORES))(
    'the %s store starts over from another version',
    (_name, store) => {
      const { migrate } = store.persist.getOptions();

      expect(migrate).toBe(startOverFromOtherVersion);
      expect(migrate?.({ anything: 'from an older build' }, 0)).toBeUndefined();
    },
  );

  describe('rehydration', () => {
    const saved = new Map<string, string>();
    const memoryStorage = createJSONStorage(() => ({
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
      removeItem: (key: string) => {
        saved.delete(key);
      },
    }));
    const key = 'kavi-tool-permissions';
    const disallowWebFetch = { permissions: [{ toolName: 'web_fetch', allowed: false }] };

    beforeEach(() => {
      saved.clear();
      useToolPermissionsStore.setState({ permissions: [] });
      useToolPermissionsStore.persist.setOptions({ storage: memoryStorage });
    });

    it('loads state written at the current version unchanged', async () => {
      saved.set(key, JSON.stringify({ state: disallowWebFetch, version: 0 }));

      await useToolPermissionsStore.persist.rehydrate();

      expect(useToolPermissionsStore.getState().isAllowed('web_fetch')).toBe(false);
    });

    it('starts over and rewrites storage when the stored version differs', async () => {
      saved.set(key, JSON.stringify({ state: disallowWebFetch, version: 99 }));

      await useToolPermissionsStore.persist.rehydrate();

      expect(useToolPermissionsStore.getState().isAllowed('web_fetch')).toBe(true);
      expect(JSON.parse(saved.get(key)!)).toEqual({ state: { permissions: [] }, version: 0 });
    });
  });
});
