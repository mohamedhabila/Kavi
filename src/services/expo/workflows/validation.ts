import { executeSshCommand } from '../../ssh/connector';
import type { AppSettings } from '../../../types/settings';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../../types/remote';
import type { ExpoProjectCheck } from '../contracts';
import { githubApi } from '../../github/api';
import {
  normalizeRepo,
  requireExpoProjectPath,
  requireGitHubWorkflowFile,
  requireGitHubWorkflowRepo,
  resolveExpoProjectSshTarget,
  shellQuote,
} from '../projectState';
import {
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
  getExpoProjectReadinessLabel,
} from '../projectAutomation';
import { resolveExpoAccountToken, resolveProjectGithubToken } from '../secrets';
import { selectWorkflowFileForAction } from '../workflowSelection';
import { ensureExpoProjectCloudMetadataAsync } from './expoHostedRuns';
async function validateExpoProjectExecution(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  settings: Pick<AppSettings, 'sshTargets'>,
): Promise<ExpoProjectCheck[]> {
  const readiness = getExpoProjectReadiness(project, account, settings);
  const checks: ExpoProjectCheck[] = [];

  if (!readiness.launchable) {
    return [{ stage: 'config', ok: false, message: getExpoProjectReadinessLabel(readiness) }];
  }

  checks.push({ stage: 'config', ok: true, message: 'Configuration ready' });

  const executionMode = getExpoProjectExecutionMode(project, account);

  if (executionMode === 'eas-workflow') {
    const token = await resolveExpoAccountToken(account);
    checks.push({ stage: 'secret', ok: true, message: 'Expo token available' });

    const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
    const workflowFile = selectWorkflowFileForAction(hydratedProject);
    if (!workflowFile) {
      throw new Error('missing-workflow-file');
    }

    checks.push({
      stage: 'project',
      ok: true,
      message: `Linked repo ready · ${normalizeRepo(hydratedProject.repoFullName)}`,
    });
    checks.push({
      stage: 'workflow',
      ok: true,
      message: `Expo workflow ready · ${workflowFile} · push a commit to trigger runs`,
    });
    return checks;
  }

  if (executionMode === 'direct-ssh') {
    const token = await resolveExpoAccountToken(account);
    checks.push({ stage: 'secret', ok: true, message: 'Expo token available' });

    const sshTarget = resolveExpoProjectSshTarget(project, settings);
    const projectPath = requireExpoProjectPath(project);
    const command = [
      `export EXPO_TOKEN=${shellQuote(token)}`,
      `cd ${shellQuote(projectPath)}`,
      `test -f package.json`,
      `([ -f eas.json ] || [ -f app.json ] || [ -f app.config.js ] || [ -f app.config.ts ])`,
      `npx --yes eas-cli@latest whoami --non-interactive`,
    ].join(' && ');
    const output = await executeSshCommand(sshTarget, command);
    const firstLine =
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || 'EAS CLI ready';
    checks.push({ stage: 'project', ok: true, message: `Project path validated · ${projectPath}` });
    checks.push({ stage: 'ssh', ok: true, message: firstLine });
    return checks;
  }

  const githubToken = await resolveProjectGithubToken(project);
  checks.push({ stage: 'secret', ok: true, message: 'GitHub token available' });

  const repo = requireGitHubWorkflowRepo(project);
  const workflowFile = requireGitHubWorkflowFile(project);
  const workflow = await githubApi<{ path: string; state: string; name?: string }>(
    `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}`,
    githubToken,
  );
  checks.push({
    stage: 'workflow',
    ok: true,
    message: `Workflow reachable · ${workflow.name || workflow.path} (${workflow.state || 'active'})`,
  });
  return checks;
}

export { validateExpoProjectExecution };
