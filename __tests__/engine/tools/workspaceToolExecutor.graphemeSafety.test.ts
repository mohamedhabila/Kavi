const mockWorkspaceTarget = { id: 'target-1', name: 'Target One' };

jest.mock('../../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ workspaceTargets: [mockWorkspaceTarget] }),
  },
}));

const mockDelegateWorkspaceTask = jest.fn();
jest.mock('../../../src/services/workspaces/control', () => ({
  delegateWorkspaceTask: (...args: unknown[]) => mockDelegateWorkspaceTask(...args),
  getWorkspaceTargetControlStatus: jest.fn(),
  launchWorkspaceBrowserSession: jest.fn(),
}));

import { executeWorkspaceTool } from '../../../src/engine/tools/workspaceToolExecutor';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeWorkspaceTool(workspace_delegate_task) — output/command preview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 4000-char output preview budget`, async () => {
      const output = buildBoundaryStraddlingText(4000, cluster, 200);
      mockDelegateWorkspaceTask.mockResolvedValue({
        output,
        command: 'echo hello',
        providerLabel: 'ssh',
        targetId: 'target-1',
        mode: 'agent',
      });

      const outcome = await executeWorkspaceTool('workspace_delegate_task', {
        targetId: 'target-1',
        prompt: 'do the thing',
      });

      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.output ?? ''));
    });

    it(`never splits ${name} straddling the 240-char command preview budget`, async () => {
      const command = buildBoundaryStraddlingText(240, cluster, 100);
      mockDelegateWorkspaceTask.mockResolvedValue({
        output: 'ok',
        command,
        providerLabel: 'ssh',
        targetId: 'target-1',
        mode: 'agent',
      });

      const outcome = await executeWorkspaceTool('workspace_delegate_task', {
        targetId: 'target-1',
        prompt: 'do the thing',
      });

      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed.commandPreview ?? ''));
    });
  }
});
