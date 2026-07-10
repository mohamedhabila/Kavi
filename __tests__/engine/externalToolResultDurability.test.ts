import { resolveExternalToolResultDurability } from '../../src/engine/durability/externalToolResult';

const expoContext = {
  project: {
    id: 'local-project',
    easProjectId: 'eas-project-id',
    name: 'Mobile',
    accountId: 'expo-account',
    owner: 'owner',
    slug: 'mobile',
    enabled: true,
    mode: 'eas-workflow' as const,
  },
  account: {
    id: 'expo-account',
    name: 'Expo',
    owner: 'owner',
    tokenRef: 'PROJECT_EXPO_TOKEN',
    enabled: true,
  },
};

describe('external tool result durability resolution', () => {
  it('classifies a production-shaped Expo action result before output processing', () => {
    expect(
      resolveExternalToolResultDurability(
        {
          toolName: 'expo_eas_build',
          argumentsText: JSON.stringify({ projectId: 'local-project', platform: 'android' }),
          resultText: JSON.stringify({
            mode: 'eas-workflow',
            jobId: 'remote-job',
            workflowRun: {
              id: 'd7f109d3-2c6b-45ed-99e8-b94f120901ab',
              status: 'NEW',
              url: 'https://expo.dev/workflows/d7f109d3',
            },
          }),
        },
        { resolveExpoProjectContext: () => expoContext },
      ),
    ).toEqual({
      kind: 'external',
      observedStatus: 'pending',
      remote: {
        provider: 'expo',
        target: 'eas-project-id',
        workflowRunId: 'd7f109d3-2c6b-45ed-99e8-b94f120901ab',
      },
      handle: {
        version: 1,
        kind: 'expo_workflow_run',
        sourceToolName: 'expo_eas_build',
        projectId: 'eas-project-id',
        workflowRunId: 'd7f109d3-2c6b-45ed-99e8-b94f120901ab',
        credentialRef: 'PROJECT_EXPO_TOKEN',
      },
    });
  });

  it('classifies an Expo action backed by an exact GitHub workflow run', () => {
    const context = {
      ...expoContext,
      project: {
        ...expoContext.project,
        mode: 'github-workflow' as const,
        repoFullName: 'OpenAI/Kavi-Mobile',
        githubTokenRef: 'PROJECT_GITHUB_TOKEN',
      },
    };
    expect(
      resolveExternalToolResultDurability(
        {
          toolName: 'expo_eas_update',
          argumentsText: JSON.stringify({ projectId: 'local-project' }),
          resultText: JSON.stringify({
            mode: 'github-workflow',
            workflowRun: { id: 123456789, status: 'in_progress', conclusion: null },
          }),
        },
        { resolveExpoProjectContext: () => context },
      ),
    ).toMatchObject({
      kind: 'external',
      observedStatus: 'running',
      handle: {
        kind: 'github_workflow_run',
        repository: 'openai/kavi-mobile',
        workflowRunId: '123456789',
        credentialRef: 'PROJECT_GITHUB_TOKEN',
      },
    });
  });

  it('keeps GitHub action-required runs unresolved for authoritative reconciliation', () => {
    expect(
      resolveExternalToolResultDurability(
        {
          toolName: 'expo_eas_submit',
          argumentsText: JSON.stringify({ projectId: 'local-project' }),
          resultText: JSON.stringify({
            mode: 'github-workflow',
            workflowRun: { id: 123456789, status: 'completed', conclusion: 'action_required' },
          }),
        },
        {
          resolveExpoProjectContext: () => ({
            ...expoContext,
            project: {
              ...expoContext.project,
              mode: 'github-workflow',
              repoFullName: 'openai/kavi-mobile',
            },
          }),
        },
      ),
    ).toMatchObject({ kind: 'external', observedStatus: 'unknown' });
  });

  it('maps an exact terminal monitor result without selecting a list entry', () => {
    expect(
      resolveExternalToolResultDurability(
        {
          toolName: 'expo_eas_workflow_wait',
          argumentsText: JSON.stringify({ projectId: 'local-project', workflowRunId: 'run-1' }),
          resultText: JSON.stringify({
            status: 'ok',
            mode: 'eas-workflow',
            workflowRun: { id: 'run-1', status: 'SUCCESS' },
          }),
        },
        { resolveExpoProjectContext: () => expoContext },
      ),
    ).toMatchObject({ kind: 'external', observedStatus: 'succeeded' });

    expect(
      resolveExternalToolResultDurability({
        toolName: 'expo_eas_workflow_runs',
        argumentsText: JSON.stringify({ projectId: 'local-project', limit: 1 }),
        resultText: JSON.stringify({
          status: 'ok',
          mode: 'eas-workflow',
          runs: [{ id: 'run-1', status: 'IN_PROGRESS' }],
        }),
      }),
    ).toEqual({ kind: 'not_external' });
  });

  it('fails closed when a successful dispatch cannot identify its remote run', () => {
    expect(
      resolveExternalToolResultDurability(
        {
          toolName: 'expo_eas_build',
          argumentsText: JSON.stringify({ projectId: 'local-project' }),
          resultText: JSON.stringify({ mode: 'github-workflow', jobId: 'job-1' }),
        },
        {
          resolveExpoProjectContext: () => ({
            ...expoContext,
            project: {
              ...expoContext.project,
              mode: 'github-workflow',
              repoFullName: 'openai/kavi-mobile',
            },
          }),
        },
      ),
    ).toEqual({
      kind: 'untracked_external',
      reason: 'external_run_unidentified',
      remote: null,
    });
  });

  it('rejects stale project mode and missing secure credential references', () => {
    const resultText = JSON.stringify({
      mode: 'eas-workflow',
      workflowRun: { id: 'run-1', status: 'NEW' },
    });
    expect(
      resolveExternalToolResultDurability(
        {
          toolName: 'expo_eas_build',
          argumentsText: JSON.stringify({ projectId: 'local-project' }),
          resultText,
        },
        {
          resolveExpoProjectContext: () => ({
            ...expoContext,
            project: { ...expoContext.project, mode: 'github-workflow' },
          }),
        },
      ),
    ).toMatchObject({ kind: 'untracked_external', reason: 'provider_contract_invalid' });

    expect(
      resolveExternalToolResultDurability(
        {
          toolName: 'expo_eas_build',
          argumentsText: JSON.stringify({ projectId: 'local-project' }),
          resultText,
        },
        {
          resolveExpoProjectContext: () => ({
            ...expoContext,
            account: { ...expoContext.account, tokenRef: undefined },
          }),
        },
      ),
    ).toMatchObject({ kind: 'untracked_external', reason: 'project_configuration_invalid' });
  });
});
