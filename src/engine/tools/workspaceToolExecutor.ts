import { useSettingsStore } from '../../store/useSettingsStore';
import {
  delegateWorkspaceTask,
  getWorkspaceTargetControlStatus,
  launchWorkspaceBrowserSession,
  type WorkspaceDelegationMode,
} from '../../services/workspaces/control';
import type { WorkspaceTargetConfig } from '../../types/remote';
import { getOptionalToolStringArg, requireToolStringArg } from './fileArgumentUtils';

function resolveWorkspaceTarget(targetId: string): WorkspaceTargetConfig {
  const targets: WorkspaceTargetConfig[] = useSettingsStore.getState().workspaceTargets || [];
  const target = targets.find((entry) => entry.id === targetId);
  if (!target) throw new Error(`Workspace target not found: ${targetId}`);
  return target;
}

export async function executeWorkspaceTool(name: string, args: any): Promise<string> {
  const rawArgs = args as Record<string, unknown>;

  if (name === 'workspace_status') {
    const targetIdArg = getOptionalToolStringArg(rawArgs, 'targetId', name);
    if (targetIdArg.error) return targetIdArg.error;

    const settings = useSettingsStore.getState();
    const targets = targetIdArg.value
      ? [resolveWorkspaceTarget(targetIdArg.value)]
      : settings.workspaceTargets || [];
    const statuses = targets.map((target) => getWorkspaceTargetControlStatus(target, settings));

    return JSON.stringify({
      summary: targetIdArg.value
        ? statuses[0]?.summary || 'Workspace target not found.'
        : statuses.length > 0
          ? `Found ${statuses.length} configured workspace targets.`
          : 'No configured workspace targets.',
      targets: statuses,
    });
  }

  const targetIdArg = requireToolStringArg(rawArgs, 'targetId', name);
  if (targetIdArg.error) return targetIdArg.error;

  const target = resolveWorkspaceTarget(targetIdArg.value!);

  switch (name) {
    case 'workspace_launch_browser': {
      const providerIdArg = getOptionalToolStringArg(rawArgs, 'providerId', name);
      if (providerIdArg.error) return providerIdArg.error;
      const result = await launchWorkspaceBrowserSession(target, {
        providerId: providerIdArg.value,
        settings: useSettingsStore.getState(),
      });
      return JSON.stringify({
        summary: `Workspace browser session launched for ${target.name}.`,
        targetId: target.id,
        sessionId: result.sessionId,
        providerId: result.providerId,
        url: result.url,
      });
    }
    case 'workspace_delegate_task': {
      const promptArg = requireToolStringArg(rawArgs, 'prompt', name);
      if (promptArg.error) return promptArg.error;
      const modeArg = getOptionalToolStringArg(rawArgs, 'mode', name);
      if (modeArg.error) return modeArg.error;

      const mode = (modeArg.value || 'agent') as WorkspaceDelegationMode;
      if (!['agent', 'plan', 'ask'].includes(mode)) {
        return 'Error: "mode" for workspace_delegate_task must be one of "agent", "plan", or "ask".';
      }

      const result = await delegateWorkspaceTask(target, promptArg.value!, {
        mode,
        settings: useSettingsStore.getState(),
      });
      const outputPreview =
        result.output.length > 4000 ? `${result.output.slice(0, 4000)}...` : result.output;

      return JSON.stringify({
        summary: `Delegated task to ${target.name} via ${result.providerLabel}.`,
        targetId: result.targetId,
        sshTargetId: result.sshTargetId,
        mode: result.mode,
        commandPreview: result.command.slice(0, 240),
        output: outputPreview,
        outputChars: result.output.length,
        truncated: outputPreview.length !== result.output.length,
      });
    }
    default:
      return `Error: unhandled workspace tool "${name}"`;
  }
}
