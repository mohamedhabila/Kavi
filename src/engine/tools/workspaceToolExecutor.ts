import { useSettingsStore } from '../../store/useSettingsStore';
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  listWorkspaceDirectory,
  makeWorkspaceDirectory,
  renameWorkspaceFile,
  deleteWorkspaceFile,
} from '../../services/workspaces/files';
import {
  delegateWorkspaceTask,
  getWorkspaceTargetControlStatus,
  launchWorkspaceBrowserSession,
  type WorkspaceDelegationMode,
} from '../../services/workspaces/control';
import type { WorkspaceTargetConfig } from '../../types';
import { getOptionalToolStringArg, requireToolStringArg } from './fileArgumentUtils';
import {
  normalizeWorkspaceListResult,
  normalizeWorkspaceMutationResult,
  normalizeWorkspaceReadResult,
} from './toolResultNormalization';

function resolveWorkspaceTarget(targetId: string): WorkspaceTargetConfig {
  const targets: WorkspaceTargetConfig[] = useSettingsStore.getState().workspaceTargets || [];
  const target = targets.find((entry) => entry.id === targetId);
  if (!target) throw new Error(`Workspace target not found: ${targetId}`);
  return target;
}

export async function executeWorkspaceTool(name: string, args: any): Promise<string> {
  const rawArgs = args as Record<string, unknown>;

  // workspace_fs is a single discriminated tool that maps to legacy
  // workspace_{read_file,write_file,list_files,mkdir,rename,delete} executors.
  if (name === 'workspace_fs') {
    const action = typeof rawArgs?.action === 'string' ? rawArgs.action.toLowerCase() : '';
    switch (action) {
      case 'list':
      case 'ls':
        return executeWorkspaceTool('workspace_list_files', args);
      case 'read':
        return executeWorkspaceTool('workspace_read_file', args);
      case 'write':
        return executeWorkspaceTool('workspace_write_file', args);
      case 'mkdir':
      case 'make_directory':
        return executeWorkspaceTool('workspace_mkdir', args);
      case 'rename':
      case 'move':
        return executeWorkspaceTool('workspace_rename', args);
      case 'delete':
      case 'remove':
      case 'rm':
        return executeWorkspaceTool('workspace_delete', args);
      default:
        return 'Error: workspace_fs requires action ∈ {list, read, write, mkdir, rename, delete}';
    }
  }

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
    case 'workspace_read_file': {
      const pathArg = requireToolStringArg(rawArgs, 'path', name);
      if (pathArg.error) return pathArg.error;
      const result = await readWorkspaceFile(target, pathArg.value!);
      return normalizeWorkspaceReadResult({
        targetId: target.id,
        path: result.path,
        content: result.content,
        size: result.size,
      });
    }
    case 'workspace_write_file': {
      const pathArg = requireToolStringArg(rawArgs, 'path', name);
      if (pathArg.error) return pathArg.error;
      const contentArg = requireToolStringArg(rawArgs, 'content', name, { allowEmpty: true });
      if (contentArg.error) return contentArg.error;
      const result = await writeWorkspaceFile(target, pathArg.value!, contentArg.value!);
      return normalizeWorkspaceMutationResult({
        targetId: target.id,
        action: 'written',
        path: result.path,
        size: result.size,
      });
    }
    case 'workspace_list_files': {
      const pathArg = getOptionalToolStringArg(rawArgs, 'path', name);
      if (pathArg.error) return pathArg.error;
      const result = await listWorkspaceDirectory(target, pathArg.value || '.');
      return normalizeWorkspaceListResult({
        targetId: target.id,
        path: result.path,
        entries: result.entries,
      });
    }
    case 'workspace_mkdir': {
      const pathArg = requireToolStringArg(rawArgs, 'path', name);
      if (pathArg.error) return pathArg.error;
      await makeWorkspaceDirectory(target, pathArg.value!);
      return normalizeWorkspaceMutationResult({
        targetId: target.id,
        action: 'created',
        path: pathArg.value!,
      });
    }
    case 'workspace_rename': {
      const oldPathArg = requireToolStringArg(rawArgs, 'oldPath', name);
      if (oldPathArg.error) return oldPathArg.error;
      const newPathArg = requireToolStringArg(rawArgs, 'newPath', name);
      if (newPathArg.error) return newPathArg.error;
      await renameWorkspaceFile(target, oldPathArg.value!, newPathArg.value!);
      return normalizeWorkspaceMutationResult({
        targetId: target.id,
        action: 'renamed',
        oldPath: oldPathArg.value!,
        newPath: newPathArg.value!,
      });
    }
    case 'workspace_delete': {
      const pathArg = requireToolStringArg(rawArgs, 'path', name);
      if (pathArg.error) return pathArg.error;
      await deleteWorkspaceFile(target, pathArg.value!);
      return normalizeWorkspaceMutationResult({
        targetId: target.id,
        action: 'deleted',
        path: pathArg.value!,
      });
    }
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
