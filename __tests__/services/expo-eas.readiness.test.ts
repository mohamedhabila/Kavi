import {
  account,
  directProject,
  mockExpoEasHarnessState,
  mockAddRemoteArtifact,
  mockExecuteSshCommand,
  mockUpdateRemoteJob,
  resetExpoEasMocks,
} from '../helpers/expoEasHarness';
import {
  getExpoAutomationSummary,
  getExpoProjectReadiness,
} from '../../src/services/expo/projectAutomation';
import { resolveExpoProject } from '../../src/services/expo/projectState';
import { buildExpoDeployWorkflowTemplate } from '../../src/services/expo/workflowSelection';
import { probeExpoProject, runExpoProjectAction } from '../../src/services/expo/workflowActions';

describe('expo eas readiness and direct execution', () => {
  beforeEach(() => {
    resetExpoEasMocks();
  });

  it('resolves project full names using the linked account owner when the project owner is blank', () => {
    mockExpoEasHarnessState.settingsState = {
      expoAccounts: [account],
      expoProjects: [
        {
          ...directProject,
          owner: '',
        },
      ],
      sshTargets: [
        {
          id: 'ssh-1',
          name: 'Build box',
          host: 'ssh.example.com',
          port: 22,
          username: 'builder',
          enabled: true,
        },
      ],
    };

    expect(resolveExpoProject('@kavi/kavi-app', mockExpoEasHarnessState.settingsState).id).toBe(
      'expo-project-1',
    );
  });

  it('marks direct mode ready when account, token, ssh target, and path exist', () => {
    expect(
      getExpoProjectReadiness(directProject, account, {
        sshTargets: [{ id: 'ssh-1', enabled: true }] as any,
      }),
    ).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('marks github-workflow mode not ready when githubTokenRef is missing', () => {
    const workflowProject = {
      id: 'expo-wf',
      name: 'Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      mode: 'github-workflow' as const,
      repoFullName: 'kavi/mobile',
      workflowFile: '.github/workflows/eas.yml',
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
      // No githubTokenRef
    };
    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: false,
      reason: 'missing-github-token',
    });
  });

  it('falls back to Expo-hosted workflows for synced projects with stale github mode', () => {
    const workflowProject = {
      id: 'expo-synced-workflow',
      easProjectId: 'eas-project-synced',
      name: 'Synced Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      source: 'account-sync' as const,
      mode: 'github-workflow' as const,
      repoFullName: 'kavi/mobile',
      availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
      workflowFile: '.eas/workflows/deploy-to-production.yml',
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
    };

    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('marks github-workflow mode ready when githubTokenRef is present', () => {
    const workflowProject = {
      id: 'expo-wf',
      name: 'Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      mode: 'github-workflow' as const,
      repoFullName: 'kavi/mobile',
      workflowFile: '.github/workflows/eas.yml',
      githubTokenRef: 'GITHUB_TOKEN',
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
    };
    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('marks eas-workflow mode ready when a linked repo and workflow are available', () => {
    const workflowProject = {
      id: 'expo-eas-workflow',
      easProjectId: 'eas-project-3',
      name: 'Hosted Workflow',
      accountId: 'expo-account-1',
      owner: 'kavi',
      slug: 'kavi-app',
      enabled: true,
      mode: 'eas-workflow' as const,
      repoFullName: 'kavi/mobile',
      workflowFile: '.eas/workflows/deploy-to-production.yml',
      availableWorkflowFiles: ['.eas/workflows/deploy-to-production.yml'],
      platforms: ['android'] as Array<'android' | 'ios' | 'web'>,
    };

    expect(getExpoProjectReadiness(workflowProject, account)).toEqual({
      launchable: true,
      reason: 'ready',
    });
  });

  it('builds the official Expo deploy workflow template for a target branch', () => {
    const template = buildExpoDeployWorkflowTemplate('release');

    expect(template.path).toBe('.eas/workflows/deploy.yml');
    expect(template.branch).toBe('release');
    expect(template.content).toContain("branches: ['release']");
    expect(template.content).toContain('type: deploy');
    expect(template.content).toContain('environment: production');
    expect(template.note).toContain('Manual eas workflow:run is optional');
  });

  it('summarizes commit-driven Expo automation and suggests deploy.yml when needed', () => {
    const automation = getExpoAutomationSummary(
      {
        id: 'expo-project-web',
        name: 'Web Project',
        owner: 'kavi',
        slug: 'web-project',
        mode: 'eas-workflow',
        repoFullName: 'kavi/mobile',
        workflowFile: '.eas/workflows/build.yml',
        availableWorkflowFiles: ['.eas/workflows/build.yml'],
        workflowRef: 'release',
        repoDefaultBranch: 'main',
        platforms: ['web'],
      } as any,
      account,
    );

    expect(automation.preferredFlow).toBe('commit-driven-eas-workflow');
    expect(automation.autoTriggerOnPush).toBe(true);
    expect(automation.repoLinked).toBe(true);
    expect(automation.workflowFile).toBe('.eas/workflows/build.yml');
    expect(automation.recommendedBranch).toBe('release');
    expect(automation.recommendedMonitoringTools).toEqual([
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
    ]);
    expect(automation.deployWorkflow).toEqual(
      expect.objectContaining({
        path: '.eas/workflows/deploy.yml',
        branch: 'release',
      }),
    );
    expect(automation.recommendedFlow.join(' ')).toContain('Push a commit to release');
  });

  it('runs a direct SSH-backed build', async () => {
    mockExecuteSshCommand.mockResolvedValue('Build queued');
    const result = await runExpoProjectAction('expo-project-1', 'build', { platform: 'android' });

    expect(result.mode).toBe('direct-ssh');
    expect(mockExecuteSshCommand).toHaveBeenCalledTimes(2);
    expect(mockExecuteSshCommand.mock.calls[0][1]).toContain('eas-cli@latest whoami');
    expect(mockExecuteSshCommand.mock.calls[1][1]).toContain('eas-cli@latest build');
    expect(mockUpdateRemoteJob).toHaveBeenCalledWith(
      'remote-job-1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(mockAddRemoteArtifact).toHaveBeenCalledWith(
      'remote-job-1',
      expect.objectContaining({ kind: 'log-snippet' }),
    );
  });

  it('probes a direct project through SSH-backed whoami', async () => {
    mockExecuteSshCommand.mockResolvedValue('kavi');
    const result = await probeExpoProject('expo-project-1');
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(4);
    expect(result.message).toContain('kavi');
  });
});
