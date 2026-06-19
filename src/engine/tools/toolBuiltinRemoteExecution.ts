import { executeExpoEasBuild, executeExpoEasCreateProject, executeExpoEasDeployWeb, executeExpoEasListProjects, executeExpoEasProbe, executeExpoEasStatus, executeExpoEasSubmit, executeExpoEasUpdate } from './builtin-expoProjectExecution';
import { executeExpoEasGraphql, executeExpoEasWorkflowRuns, executeExpoEasWorkflowStatus, executeExpoEasWorkflowWait } from './builtin-expoWorkflowExecution';
import { executeSshBackgroundJobStatus, executeSshBackgroundJobWait, executeSshDeletePath, executeSshExec, executeSshListDirectory, executeSshMakeDirectory, executeSshReadFile, executeSshRenamePath, executeSshWriteFile } from './builtin-ssh';
import { executeToolCatalog } from './builtin-tool-catalog';
import { executeToolDescribe } from './builtin-tool-describe';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';

export const BUILTIN_REMOTE_TOOL_NAMES = new Set([
  'ssh_exec',
  'ssh_background_job_status',
  'ssh_background_job_wait',
  'ssh_fs',
  'ssh_list_directory',
  'ssh_read_file',
  'ssh_write_file',
  'ssh_rename_path',
  'ssh_delete_path',
  'ssh_make_directory',
  'expo_eas_create_project',
  'expo_eas_list_projects',
  'expo_eas_status',
  'expo_eas_probe',
  'expo_eas_build',
  'expo_eas_update',
  'expo_eas_submit',
  'expo_eas_deploy_web',
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
  'expo_eas_graphql',
  'tool_catalog',
  'tool_describe',
]);

export async function executeBuiltinRemoteTool(
  params: BuiltinToolExecutionParams,
): Promise<string | null> {
  const { name, args, context } = params;

  switch (name) {
    case 'ssh_exec':
      return executeSshExec(args);
    case 'ssh_background_job_status':
      return executeSshBackgroundJobStatus(args);
    case 'ssh_background_job_wait':
      return executeSshBackgroundJobWait(args);
    case 'ssh_fs': {
      const action = args && typeof args.action === 'string' ? String(args.action).toLowerCase() : '';
      switch (action) {
        case 'list':
        case 'ls':
          return executeSshListDirectory(args);
        case 'read':
          return executeSshReadFile(args);
        case 'write':
          return executeSshWriteFile(args);
        case 'rename':
        case 'move':
          return executeSshRenamePath(args);
        case 'delete':
        case 'remove':
        case 'rm':
          return executeSshDeletePath(args);
        case 'mkdir':
        case 'make_directory':
          return executeSshMakeDirectory(args);
        default:
          return 'Error: ssh_fs requires action ∈ {list, read, write, rename, delete, mkdir}';
      }
    }
    case 'ssh_list_directory':
      return executeSshListDirectory(args);
    case 'ssh_read_file':
      return executeSshReadFile(args);
    case 'ssh_write_file':
      return executeSshWriteFile(args);
    case 'ssh_rename_path':
      return executeSshRenamePath(args);
    case 'ssh_delete_path':
      return executeSshDeletePath(args);
    case 'ssh_make_directory':
      return executeSshMakeDirectory(args);
    case 'expo_eas_create_project':
      return executeExpoEasCreateProject(args);
    case 'expo_eas_list_projects':
      return executeExpoEasListProjects(args);
    case 'expo_eas_status':
      return executeExpoEasStatus(args);
    case 'expo_eas_probe':
      return executeExpoEasProbe(args);
    case 'expo_eas_build':
      return executeExpoEasBuild(args);
    case 'expo_eas_update':
      return executeExpoEasUpdate(args);
    case 'expo_eas_submit':
      return executeExpoEasSubmit(args);
    case 'expo_eas_deploy_web':
      return executeExpoEasDeployWeb(args);
    case 'expo_eas_workflow_runs':
      return executeExpoEasWorkflowRuns(args);
    case 'expo_eas_workflow_status':
      return executeExpoEasWorkflowStatus(args);
    case 'expo_eas_workflow_wait':
      return executeExpoEasWorkflowWait(args);
    case 'expo_eas_graphql':
      return executeExpoEasGraphql(args);
    case 'tool_catalog':
      return executeToolCatalog(args, {
        availableToolNames: context?.availableToolNames
          ? new Set(context.availableToolNames)
          : undefined,
      });
    case 'tool_describe':
      return executeToolDescribe(args, {
        availableToolNames: context?.availableToolNames
          ? new Set(context.availableToolNames)
          : undefined,
      });
    default:
      return null;
  }
}
