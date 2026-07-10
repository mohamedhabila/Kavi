import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import { installNativeToolExecutionEnvironment } from '../../engine/tools/native/executionEnvironment';
import { normalizeToolNameList } from '../../engine/tools/toolNameNormalization';
import { useApprovalStore } from '../../services/remote/approvalStore';
import { tryExecuteE2ENativeMobileTool } from './e2eNativeMobileFixtures';

const E2E_STATIC_TOOL_APPROVAL_KEYS = normalizeToolNameList(
  TOOL_DEFINITIONS.map((tool) => tool.name),
);

function installE2EToolApprovals(): () => void {
  const addedKeys: string[] = [];

  try {
    for (const toolName of E2E_STATIC_TOOL_APPROVAL_KEYS) {
      const store = useApprovalStore.getState();
      if (store.isAllowlisted(toolName)) continue;

      store.addToAllowlist(toolName);
      if (!useApprovalStore.getState().isAllowlisted(toolName)) {
        throw new Error(`Could not install E2E approval allowlist entry for ${toolName}.`);
      }
      addedKeys.push(toolName);
    }
  } catch (error) {
    for (const key of addedKeys) {
      useApprovalStore.getState().removeFromAllowlist(key);
    }
    throw error;
  }

  return () => {
    for (const key of addedKeys) {
      useApprovalStore.getState().removeFromAllowlist(key);
    }
  };
}

/** Installs the process-scoped native fixtures and approvals for one scenario. */
export function installE2EScenarioEnvironment(): () => void {
  const uninstallNativeEnvironment = installNativeToolExecutionEnvironment({
    tryExecute: ({ name, argsString }) => tryExecuteE2ENativeMobileTool(name, argsString),
  });

  let uninstallApprovals: (() => void) | null = null;
  try {
    uninstallApprovals = installE2EToolApprovals();
  } catch (error) {
    uninstallNativeEnvironment();
    throw error;
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    uninstallApprovals?.();
    uninstallNativeEnvironment();
  };
}
