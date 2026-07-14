import { installE2EScenarioEnvironment } from '../../src/acceptance/e2eAgent/e2eScenarioEnvironment';
import { resetE2ENativeMobileFixtures } from '../../src/acceptance/e2eAgent/e2eNativeMobileFixtures';
import { tryExecuteNativeToolInEnvironment } from '../../src/engine/tools/native/executionEnvironment';
import {
  needsApprovalWithContext,
  useApprovalStore,
} from '../../src/services/remote/approvalStore';
import { parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('E2E scenario environment', () => {
  let uninstallEnvironment: (() => void) | null = null;

  beforeEach(() => {
    resetE2ENativeMobileFixtures();
    useApprovalStore.setState({ allowlist: [] });
  });

  afterEach(() => {
    uninstallEnvironment?.();
    uninstallEnvironment = null;
    useApprovalStore.setState({ allowlist: [] });
  });

  it('scopes native fixtures and normal approval allowlist entries to the run', async () => {
    expect(needsApprovalWithContext('calendar_list', {})).toBe(true);
    expect(
      await tryExecuteNativeToolInEnvironment({
        name: 'calendar_list',
        argsString: '{}',
        conversationId: 'before-e2e',
      }),
    ).toBeNull();

    uninstallEnvironment = installE2EScenarioEnvironment();

    expect(needsApprovalWithContext('calendar_list', {})).toBe(false);
    const outcome = await tryExecuteNativeToolInEnvironment({
      name: 'calendar_list',
      argsString: '{}',
      conversationId: 'during-e2e',
    });
    expect(outcome).not.toBeNull();
    expect(parseCompletedToolOutcome(outcome!)).toEqual([
      expect.objectContaining({ id: 'e2e-cal-1' }),
    ]);

    uninstallEnvironment();
    uninstallEnvironment = null;

    expect(needsApprovalWithContext('calendar_list', {})).toBe(true);
    expect(
      await tryExecuteNativeToolInEnvironment({
        name: 'calendar_list',
        argsString: '{}',
        conversationId: 'after-e2e',
      }),
    ).toBeNull();
  });

  it('preserves approval entries that predate the acceptance run', () => {
    useApprovalStore.setState({
      allowlist: [
        { key: 'calendar_list', addedAt: 1 },
        { key: 'existing-tool', addedAt: 2 },
      ],
    });

    uninstallEnvironment = installE2EScenarioEnvironment();
    uninstallEnvironment();
    uninstallEnvironment = null;

    expect(useApprovalStore.getState().allowlist).toEqual([
      { key: 'calendar_list', addedAt: 1 },
      { key: 'existing-tool', addedAt: 2 },
    ]);
  });

  it('authorizes non-native static tools through the same scoped allowlist', () => {
    expect(needsApprovalWithContext('workspace_delegate_task', {})).toBe(true);

    uninstallEnvironment = installE2EScenarioEnvironment();

    expect(needsApprovalWithContext('workspace_delegate_task', {})).toBe(false);

    uninstallEnvironment();
    uninstallEnvironment = null;
    expect(needsApprovalWithContext('workspace_delegate_task', {})).toBe(true);
  });
});
