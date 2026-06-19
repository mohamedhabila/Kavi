import {
  executeExpoEasBuild,
  executeExpoEasCreateProject,
  executeExpoEasDeployWeb,
  executeExpoEasGraphql,
  executeExpoEasListProjects,
  executeExpoEasProbe,
  executeExpoEasStatus,
  executeExpoEasSubmit,
  executeExpoEasUpdate,
  executeExpoEasWorkflowRuns,
  executeExpoEasWorkflowStatus,
  executeExpoEasWorkflowWait,
  installBuiltinExecutorWrapperReset,
  mockCreateExpoProject,
  mockListExpoProjects,
} from '../helpers/builtinExecutorWrappersHarness';

describe('builtin-executor wrapper coverage', () => {
  installBuiltinExecutorWrapperReset();

  it('normalizes Expo list, create, and status payloads with automation guidance', async () => {
    const list = JSON.parse(await executeExpoEasListProjects({ refresh: true }));
    const created = JSON.parse(
      await executeExpoEasCreateProject({ accountId: 'acct-1', name: 'Kavi' }),
    );
    const status = JSON.parse(await executeExpoEasStatus({ projectId: 'expo-1' }));

    expect(list).toEqual(
      expect.objectContaining({
        status: 'ok',
        count: 1,
        preferredFlow: 'commit-driven-eas-workflow',
        selection: expect.objectContaining({ defaultProjectId: 'expo-1' }),
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        status: 'ok',
        project: expect.objectContaining({ id: 'expo-1', name: 'Kavi' }),
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(status).toEqual(
      expect.objectContaining({
        status: 'ok',
        preferredFlow: 'commit-driven-eas-workflow',
        project: expect.objectContaining({ id: 'expo-1', name: 'Kavi' }),
      }),
    );
    expect(mockListExpoProjects).toHaveBeenCalledWith({ accountId: undefined, refresh: true });
    expect(mockCreateExpoProject).toHaveBeenCalledWith({ accountId: 'acct-1', name: 'Kavi' });
  });

  it('normalizes Expo probe, action, workflow, and GraphQL wrapper payloads', async () => {
    const probe = JSON.parse(await executeExpoEasProbe({ projectId: 'expo-1' }));
    const build = JSON.parse(
      await executeExpoEasBuild({ projectId: 'expo-1', platform: 'android' }),
    );
    const update = JSON.parse(await executeExpoEasUpdate({ projectId: 'expo-1', branch: 'main' }));
    const submit = JSON.parse(await executeExpoEasSubmit({ projectId: 'expo-1', platform: 'ios' }));
    const deploy = JSON.parse(
      await executeExpoEasDeployWeb({ projectId: 'expo-1', alias: 'prod' }),
    );
    const runs = JSON.parse(await executeExpoEasWorkflowRuns({ projectId: 'expo-1', limit: 5 }));
    const workflowStatus = JSON.parse(
      await executeExpoEasWorkflowStatus({ projectId: 'expo-1', workflowRunId: 'run-1' }),
    );
    const workflowWait = JSON.parse(
      await executeExpoEasWorkflowWait({
        projectId: 'expo-1',
        workflowRunId: 'run-1',
        timeoutMs: 1000,
      }),
    );
    const graphql = JSON.parse(
      await executeExpoEasGraphql({ query: '{ viewer { id } }', projectId: 'expo-1' }),
    );

    expect(probe).toEqual(
      expect.objectContaining({
        status: 'ok',
        ok: true,
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(build).toEqual(
      expect.objectContaining({
        status: 'ok',
        jobId: 'job-build',
        preferredFlow: 'commit-driven-eas-workflow',
      }),
    );
    expect(update).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-update' }));
    expect(submit).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-submit' }));
    expect(deploy).toEqual(expect.objectContaining({ status: 'ok', jobId: 'job-deploy-web' }));
    expect(runs).toEqual(
      expect.objectContaining({
        status: 'ok',
        runs: [{ id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' }],
      }),
    );
    expect(workflowStatus).toEqual(
      expect.objectContaining({
        status: 'ok',
        workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
      }),
    );
    expect(workflowWait).toEqual(
      expect.objectContaining({
        status: 'ok',
        workflowRun: { id: 'run-1', status: 'FINISHED', conclusion: 'SUCCESS' },
        waitedMs: 2000,
      }),
    );
    expect(graphql).toEqual(
      expect.objectContaining({
        status: 'ok',
        preferredFlow: 'commit-driven-eas-workflow',
        data: { viewer: { id: 'viewer-1' } },
      }),
    );
  });
});
